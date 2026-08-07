import { randomUUID } from 'node:crypto';

/**
 * In-memory registry for background emission jobs.
 *
 * emit_invoice with background: true registers a job here and returns its
 * jobId immediately, so MCP clients with a fixed request timeout (~60s) never
 * time out on the multi-minute browser flow. emit_status reads it back.
 *
 * Jobs live in process memory: a server restart forgets them (the emission
 * itself is not interrupted mid-row by design of the issuer, but its result
 * becomes unqueryable). Only ONE emission may run at a time: emissions share
 * global state (process.env credentials, the AFIP session) and running two
 * concurrently would corrupt both.
 */

export type EmitJobStatus = 'running' | 'completed' | 'failed';

export interface EmitJobProgress {
  successSoFar: number;
  failedSoFar: number;
}

interface EmitJob {
  jobId: string;
  /** Monotonic creation order: ISO timestamps can tie within the same ms. */
  seq: number;
  status: EmitJobStatus;
  startedAt: string;
  finishedAt?: string;
  totalRows: number;
  readProgress?: () => EmitJobProgress;
  result?: unknown;
  error?: string;
}

const MAX_FINISHED_JOBS = 20;

const jobs = new Map<string, EmitJob>();
let jobSequence = 0;

function findRunningJob(): EmitJob | undefined {
  for (const job of jobs.values()) {
    if (job.status === 'running') return job;
  }
  return undefined;
}

/** jobId of the currently running emission, if any. */
export function runningEmitJobId(): string | undefined {
  return findRunningJob()?.jobId;
}

/**
 * Registers a new running job. Throws when another emission is already
 * running: the caller surfaces the message (including the running jobId) to
 * the client instead of starting a second browser against the same session.
 */
export function createEmitJob(totalRows: number): string {
  const running = findRunningJob();
  if (running) {
    throw new Error(
      `Ya hay una emisión en curso (jobId ${running.jobId}, iniciada ${running.startedAt}). ` +
      'Consultá su estado con emit_status y esperá a que termine antes de emitir de nuevo.',
    );
  }

  const jobId = randomUUID();
  jobs.set(jobId, {
    jobId,
    seq: ++jobSequence,
    status: 'running',
    startedAt: new Date().toISOString(),
    totalRows,
  });
  pruneFinishedJobs();
  return jobId;
}

/** Lets the runner expose live per-row counters (read lazily by emit_status). */
export function attachEmitJobProgress(
  jobId: string,
  readProgress: () => EmitJobProgress,
): void {
  const job = jobs.get(jobId);
  if (job) job.readProgress = readProgress;
}

export function completeEmitJob(jobId: string, result: unknown): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'completed';
  job.finishedAt = new Date().toISOString();
  job.result = result;
  job.readProgress = undefined;
}

export function failEmitJob(jobId: string, error: unknown): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'failed';
  job.finishedAt = new Date().toISOString();
  job.error = error instanceof Error ? error.message : String(error);
  job.readProgress = undefined;
}

export interface SerializedEmitJob {
  jobId: string;
  status: EmitJobStatus;
  startedAt: string;
  finishedAt?: string;
  elapsedSeconds: number;
  totalRows: number;
  successSoFar?: number;
  failedSoFar?: number;
  result?: unknown;
  error?: string;
}

export interface EmitJobsOverview {
  latest: SerializedEmitJob;
  others: Array<Pick<SerializedEmitJob, 'jobId' | 'status' | 'startedAt' | 'finishedAt'>>;
}

export interface EmitJobsEmpty {
  message: string;
}

function serializeJob(job: EmitJob): SerializedEmitJob {
  const progress = job.readProgress?.();
  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedSeconds: Math.round(
      ((job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) -
        Date.parse(job.startedAt)) / 1000,
    ),
    totalRows: job.totalRows,
    ...(progress
      ? { successSoFar: progress.successSoFar, failedSoFar: progress.failedSoFar }
      : {}),
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
  };
}

/**
 * Status of one job (by id) or, without id, the most recently started job
 * plus a summary of the rest.
 */
export function getEmitJobStatus(jobId: string): SerializedEmitJob;
export function getEmitJobStatus(
  jobId?: string,
): SerializedEmitJob | EmitJobsOverview | EmitJobsEmpty;
export function getEmitJobStatus(
  jobId?: string,
): SerializedEmitJob | EmitJobsOverview | EmitJobsEmpty {
  if (jobId) {
    const job = jobs.get(jobId);
    if (!job) {
      throw new Error(
        `No existe el job "${jobId}". Los jobs viven en memoria: si el server se reinició, ` +
        'verificá el resultado en el portal de ARCA (Comprobantes en línea → Consultas).',
      );
    }
    return serializeJob(job);
  }

  const all = [...jobs.values()].sort((a, b) => b.seq - a.seq);
  if (all.length === 0) {
    return { message: 'No hay emisiones registradas en este proceso.' };
  }
  return {
    latest: serializeJob(all[0]!),
    others: all.slice(1).map((job) => ({
      jobId: job.jobId,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    })),
  };
}

function pruneFinishedJobs(): void {
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => b.seq - a.seq);
  for (const stale of finished.slice(MAX_FINISHED_JOBS)) {
    jobs.delete(stale.jobId);
  }
}

/** Test-only: wipe the registry so cases stay independent. */
export function resetEmitJobsForTests(): void {
  jobs.clear();
}
