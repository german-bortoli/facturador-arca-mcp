import { beforeEach, describe, expect, test } from 'vitest';
import {
  attachEmitJobProgress,
  completeEmitJob,
  createEmitJob,
  failEmitJob,
  getEmitJobStatus,
  resetEmitJobsForTests,
  runningEmitJobId,
} from '../mcp/emit-jobs';

beforeEach(() => {
  resetEmitJobsForTests();
});

describe('emit job registry', () => {
  test('lifecycle: running with progress, then completed with the result', () => {
    const jobId = createEmitJob(3);
    expect(runningEmitJobId()).toBe(jobId);

    let success = 0;
    attachEmitJobProgress(jobId, () => ({ successSoFar: success, failedSoFar: 0 }));

    success = 2;
    const running = getEmitJobStatus(jobId);
    expect(running.status).toBe('running');
    expect(running.totalRows).toBe(3);
    expect(running.successSoFar).toBe(2);

    const result = { successCount: 3, failedCount: 0 };
    completeEmitJob(jobId, result);
    const done = getEmitJobStatus(jobId);
    expect(done.status).toBe('completed');
    expect(done.result).toEqual(result);
    expect(done.finishedAt).toBeDefined();
    expect(done.successSoFar).toBeUndefined(); // progress detaches on finish
    expect(runningEmitJobId()).toBeUndefined();
  });

  test('failed jobs expose the error message', () => {
    const jobId = createEmitJob(1);
    failEmitJob(jobId, new Error('AFIP login failed'));
    const status = getEmitJobStatus(jobId);
    expect(status.status).toBe('failed');
    expect(status.error).toBe('AFIP login failed');
  });

  test('only one emission may run at a time', () => {
    const first = createEmitJob(1);
    expect(() => createEmitJob(1)).toThrow(new RegExp(first));
    completeEmitJob(first, {});
    expect(() => createEmitJob(1)).not.toThrow();
  });

  test('unknown jobId throws a message pointing to the ARCA portal', () => {
    expect(() => getEmitJobStatus('nope')).toThrow(/No existe el job/);
  });

  test('without jobId returns the latest job plus a summary of the rest', () => {
    const first = createEmitJob(1);
    completeEmitJob(first, { successCount: 1 });
    const second = createEmitJob(2);

    const status = getEmitJobStatus();
    if (!('latest' in status)) {
      throw new Error('expected the latest/others variant');
    }
    expect(status.latest.jobId).toBe(second);
    expect(status.others.map((j) => j.jobId)).toContain(first);
  });

  test('empty registry reports a friendly message', () => {
    const status = getEmitJobStatus();
    expect('message' in status && status.message).toContain('No hay emisiones');
  });
});
