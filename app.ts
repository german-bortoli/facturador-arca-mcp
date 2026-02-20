import { chromium } from 'playwright';
import { navigateToFacturadorPage } from './functions';
import { DateTime } from 'luxon';
import { parseArgs } from 'util';
import { ColumnsSchema } from './types/file';
import { FileParser } from './file-parser';
import { invariant } from '@epic-web/invariant';
import { InvoiceIssuer } from './invoice-issuer';

const { values } = parseArgs({
  args: Bun.argv,
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
      default: `./${process.env.FILE}`,
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
  },
  strict: true,
  allowPositionals: true,
});

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

  const fileParser = new FileParser();
  invariant(values.file, 'File argument is required');
  console.debug(`Parsing file ${values.file} ${values.sheet ? `with sheet ${values.sheet}` : ''}`);
  const { valid, invalid } = await fileParser.parse(values.file, {
    schema: ColumnsSchema, xlsx: {
      sheetName: values.sheet || undefined,
    }
  });

  const msg = valid.length > 0 ? `Found ${valid.length} valid invoices\nFound ${invalid.length} invalid invoices:\n${invalid.map(i => JSON.stringify(i)).join('\n')}\nContinue? (y/n)\n` : 'No valid invoices found';

  if (msg === 'No valid invoices found') {
    console.debug(msg);
    console.debug('Exiting...');
    return;
  }

  console.table(valid)

  const res = await prompt(msg);
  if (res?.toLowerCase().trim() !== 'y') {
    console.debug('Exiting...');
    return;
  }

  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();
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

  await browser.close();
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

