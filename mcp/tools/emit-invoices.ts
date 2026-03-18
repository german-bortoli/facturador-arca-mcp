import { DateTime } from 'luxon';
import { basename } from 'node:path';
import { parseLegacyInvoiceCsvText } from '../parsers/legacy-invoice-csv';
import { resolveCredentials } from '../credentials-resolver';
import { startInvoiceHttpServer } from '../invoice-http-server';
import type { EmitInvoiceInput } from '../types';

function getInvoicingDate(now = false): `${string}/${string}/${string}` {
  const today = DateTime.now();
  if (now) {
    return today.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
  }
  if (today.day < 14) {
    return today.minus({ days: today.day }).toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
  }
  return today.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
}

function normalizeHeadless(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  }
  return true;
}

async function withLogsRedirectedToStderr<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const originalLog = console.log;
  const originalDebug = console.debug;
  console.log = (...args: unknown[]) => console.error(...args);
  console.debug = (...args: unknown[]) => console.error(...args);
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.debug = originalDebug;
  }
}

export async function emitInvoice(input: EmitInvoiceInput) {
  if (!input.invoiceCsvText?.trim()) {
    throw new Error('invoiceCsvText is required');
  }

  const parsed = parseLegacyInvoiceCsvText(input.invoiceCsvText);
  if (parsed.valid.length === 0) {
    return {
      invoicingDate: getInvoicingDate(Boolean(input.now)),
      validCount: 0,
      invalidCount: parsed.invalid.length,
      invalidRows: parsed.invalid,
      successCount: 0,
      failedCount: 0,
      message: 'No valid invoices found in legacy CSV',
    };
  }

  const credentials = await resolveCredentials({
    explicit: input.credentials,
    credentialsCsvText: input.credentialsCsvText,
    preferredIssuerCuit: input.preferredIssuerCuit,
    issuerCuit: input.issuerCuit,
    allowInteractivePrompt: input.allowInteractivePrompt ?? false,
  });

  // Auto-select POS: explicit > stored default > first stored POS > empty.
  let resolvedPos = input.pointOfSale?.trim() || '';
  if (!resolvedPos && credentials.storedPointsOfSale?.length) {
    resolvedPos =
      credentials.storedDefaultPointOfSale ?? credentials.storedPointsOfSale[0] ?? '';
  }

  process.env.AFIP_USERNAME = credentials.AFIP_USERNAME;
  process.env.AFIP_PASSWORD = credentials.AFIP_PASSWORD;
  process.env.AFIP_ISSUER_CUIT = credentials.AFIP_ISSUER_CUIT;
  process.env.RAZON_SOCIAL = credentials.RAZON_SOCIAL;
  process.env.POINT_OF_SALE = resolvedPos;
  process.env.CURRENCY = input.currency || process.env.CURRENCY || 'ARS';
  process.env.GLOBAL_CONCEPT = input.globalConcept || '';
  process.env.ADD_MONTH_TO_CONCEPT = input.addMonthToConcept ? 'true' : 'false';
  process.env.DEBUG = input.debug ? 'true' : 'false';

  const headlessUsed = normalizeHeadless(input.headless);

  const { chromium } = await import('playwright');
  const { navigateToFacturadorPage } = await import('../../functions');
  const { InvoiceIssuer } = await import('../../invoice-issuer');

  const browser = await chromium.launch({
    headless: headlessUsed,
    slowMo: Math.max(0, input.slowMoMs ?? 0),
    tracesDir: './traces',
  });

  return withLogsRedirectedToStderr(async () => {
    try {
      const context = await browser.newContext();
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      const facturadorPage = await navigateToFacturadorPage(page);

      facturadorPage.on('dialog', async (dialog) => {
        await dialog.accept();
      });

      const issuer = new InvoiceIssuer({
        page: facturadorPage,
        getInvoicingDate: () => getInvoicingDate(Boolean(input.now)),
        timeoutMs: 60_000,
      });

      await issuer.issueAll(parsed.valid);
      if (input.retry) {
        const failedResults = issuer.getFailedResults();
        if (failedResults.length > 0) {
          await issuer.retryFailed();
        }
      }

      let summaryPath: string | undefined;
      let summaryMetadataPath: string | undefined;
      if (input.saveSummaryPath) {
        summaryPath = await issuer.saveSummaryToFile({
          path: input.saveSummaryPath,
          format: input.summaryFormat === 'xlsx' ? 'xlsx' : 'csv',
          includeSuccess: !input.summaryFailedOnly,
          includeFailed: true,
        });
        summaryMetadataPath = `${summaryPath.replace(/\.[^.]+$/, '')}.meta.json`;
      }

      const tracePath = `traces/${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}-mcp-run.zip`;
      await context.tracing.stop({ path: tracePath });

      const failed = issuer.getFailedResults().map((result) => ({
        index: result.index,
        name: result.invoice.NOMBRE,
        document: result.invoice.NUMERO,
        error: result.error,
        isTimeout: result.isTimeout,
      }));

      const resolvedHost = input.serverHost ?? process.env.INVOICE_SERVER_HOST;
      const fileServerPort = Number(process.env.INVOICE_HTTP_SERVER_PORT ?? 8876);

      if (resolvedHost) {
        startInvoiceHttpServer(fileServerPort);
      }

      const issued = issuer
        .getSuccessResults()
        .filter((r) => r.artifactPath)
        .map((r) => {
          const entry: { name: string; artifactPath: string; downloadUrl?: string } = {
            name: r.invoice.NOMBRE ?? '',
            artifactPath: r.artifactPath!,
          };
          if (resolvedHost) {
            entry.downloadUrl = `${resolvedHost}:${fileServerPort}/public/invoices/${basename(r.artifactPath!)}`;
          }
          return entry;
        });

      return {
        invoicingDate: getInvoicingDate(Boolean(input.now)),
        headlessUsed,
        validCount: parsed.valid.length,
        invalidCount: parsed.invalid.length,
        invalidRows: parsed.invalid,
        successCount: parsed.valid.length - failed.length,
        failedCount: failed.length,
        failed,
        issued,
        summaryPath,
        summaryMetadataPath,
        tracePath,
      };
    } finally {
      await browser.close();
    }
  });
}
