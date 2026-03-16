import { chromium } from 'playwright';
import { navigateToFacturadorPage } from './functions';
import { DateTime } from 'luxon';
import { parseArgs } from 'util';
import { ColumnsSchema } from './types/file';
import type { Columns } from './types/file';
import { FileParser } from './file-parser';
import { invariant } from '@epic-web/invariant';
import { InvoiceIssuer } from './invoice-issuer';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseLegacyInvoiceCsvText } from './mcp/parsers/legacy-invoice-csv';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    now: {
      type: 'boolean',
      default: false,
    },
    date: {
      type: 'string',
      short: 'd',
    },
    file: {
      type: 'string',
      short: 'f',
      default: process.env.FILE ? `./${process.env.FILE}` : './csv/example.csv',
    },
    sheet: {
      type: 'string',
      short: 's',
    },
    retry: {
      type: 'boolean',
      default: false,
      short: 'r',
    },
    saveSummary: {
      type: 'string',
      default: `./summaries`,
    },
    summaryFormat: {
      type: 'string',
      default: 'csv',
    },
    summaryFailedOnly: {
      type: 'boolean',
      default: true,
    },
    headless: {
      type: 'string',
      default: 'true',
    },
    slowMo: {
      type: 'string',
      default: '300',
    },
  },
  strict: true,
  allowPositionals: true,
});

function parseBooleanOption(
  value: string | boolean | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

const getInvoicingDate = (): `${string}/${string}/${string}` => {
  const today = DateTime.now();

  if (values.now) {
    return today.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
  }

  // Logic to issue invoices in the previous month if the day is less than 14th
  if (today.day < 14) {
    return today.minus({ days: today.day }).toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
  } else {
    return today.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
  }
};

if (process.env.DEBUG === 'true') {
  console.debug('================= DEBUG MODE ENABLED =================');
}
console.debug(`INVOICES WILL BE ISSUED WITH DATE: ${getInvoicingDate()}`);



async function main() {
  const start = performance.now();
  const fileParser = new FileParser();
  invariant(values.file, 'File argument is required');
  console.debug(`Parsing file ${values.file} ${values.sheet ? `with sheet ${values.sheet}` : ''}`);
  let valid: Columns[] = [];
  let invalid: unknown[] = [];
  const filePath = String(values.file);
  const extension = extname(filePath).toLowerCase();

  if (extension === '.csv') {
    const csvText = await readFile(filePath, 'utf8');
    const parsed = parseLegacyInvoiceCsvText(csvText);
    valid = parsed.valid;
    invalid = parsed.invalid;
  } else {
    const parsed = await fileParser.parse(filePath, {
      schema: ColumnsSchema, xlsx: {
        sheetName: values.sheet || undefined,
      }
    });
    valid = parsed.valid;
    invalid = parsed.invalid;
  }

  const msg = valid.length > 0 ? `Found ${valid.length} valid invoices\nFound ${invalid.length} invalid invoices:\n${invalid.map(i => JSON.stringify(i)).join('\n')}\nContinue? (y/n)\n` : 'No valid invoices found';

  if (msg === 'No valid invoices found') {
    console.debug(msg);
    console.debug('Exiting...');
    return;
  }

  console.table(valid)

  const res = await askConfirmation(msg);
  if (res?.toLowerCase().trim() !== 'y') {
    console.debug('Exiting...');
    return;
  }

  const slowMoMs = Math.max(0, Number(values.slowMo) || 500);
  const headlessMode = parseBooleanOption(values.headless, true);
  console.debug(`Launching browser with headless=${headlessMode}`);
  const browser = await chromium.launch({
    headless: headlessMode,
    slowMo: slowMoMs,
    tracesDir: './traces',
  });
  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  const facturadorPage = await navigateToFacturadorPage(page);

  facturadorPage.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const issuer = new InvoiceIssuer({
    page: facturadorPage,
    getInvoicingDate,
    timeoutMs: 60_000,
  });

  await issuer.issueAll(valid);
  issuer.printSummary();

  if (values.retry) {
    const failedResults = issuer.getFailedResults();
    if (failedResults.length > 0) {
      console.log(`Retrying ${failedResults.length} failed invoices...`);
      await issuer.retryFailed();
      issuer.printSummary();
    }
  }

  if (values.saveSummary) {
    const format = values.summaryFormat === 'xlsx' ? 'xlsx' : 'csv';
    await issuer.saveSummaryToFile({
      path: values.saveSummary,
      format,
      includeSuccess: !values.summaryFailedOnly,
      includeFailed: true,
    });
  }

  const fileName = String(values.file);
  await context.tracing.stop({ path: `traces/${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}-${fileName ? fileName.split('/').pop()?.split('.').shift() : 'unknown'}.zip` });
  await browser.close();

  const end = performance.now();
  console.debug(`Total time: ${DateTime.fromMillis(end - start).toFormat('ss.SSS')} seconds`);
}

async function askConfirmation(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

