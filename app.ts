import { chromium } from 'playwright';
import * as dotenv from 'dotenv';
dotenv.config();
import {
  navigateToFacturadorPage,
  sleep,
  error,
  addAccomodationDataToInvoice,
  addExpensesDataToInvoice,
  formatNumber,
  startNewInvoice,
  getInvoiceDescription,
} from './functions';
import { DateTime } from 'luxon';
import { parseArgs } from "util";
import { ColumnsSchema } from './types/file';
import { FileParser } from './file-parser';
import { invariant } from '@epic-web/invariant';
import { mapInvoiceData } from './mappers/invoice-mapper';
import { DOCUMENT_TYPES } from './types/invoice';

const LOGIN_SUFFIX = 'contribuyente_/login.xhtml';
const BASE_URL = 'https://auth.afip.gob.ar/';

enum idTipoDocReceptor {
  DNI = '96',
  CUIT = '80',
}


const { values, positionals } = parseArgs({
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
  },
  strict: true,
  allowPositionals: true,
});

const getInvoicingDate = () => {
  const today = DateTime.now();

  if (values.now) {
    return today.toFormat('dd/MM/yyyy');
  }
  
  // Logic to issue invoices in the previous month if the day is less than 14th
  if (today.day < 14) {
    return today.minus({ days: today.day }).toFormat('dd/MM/yyyy');
  } else {
    return today.toFormat('dd/MM/yyyy');
  }
};

if (process.env.DEBUG === 'true') {
  console.debug('================= DEBUG MODE ENABLED =================');
}
console.debug(`INVOICES WILL BE ISSUED WITH DATE: ${getInvoicingDate()}`);

(async () => {
  async function main() {

    const fileParser = new FileParser();
    invariant(values.file, 'File argumet is required');
    const { valid, invalid } = await fileParser.parse(values.file, { schema: ColumnsSchema });
    const validMsg = valid.length > 0 ? `Found ${valid.length} valid invoices\nFound ${invalid.length} invalid invoices:\n${invalid.map(i => JSON.stringify(i)).join('\n')}\nContinue? (y/n)\n` : 'No valid invoices found';
    const res = await prompt(validMsg);
    if (res?.toLowerCase().trim() !== 'y') {
      console.debug('Exiting...');
      return;
    }

    const browser = await chromium.launch({ headless: false, slowMo: 500 });
    const page = await browser.newPage();
    await page.goto(BASE_URL + LOGIN_SUFFIX);
    const facturadorPage = await navigateToFacturadorPage(page);

    facturadorPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    for (const inv of valid) {
      
      await sleep(facturadorPage, 1000);
      console.debug(
        `⏳ Issuing ${inv.NOMBRE} invoice for ${inv.TOTAL} ...`
      );
      await startNewInvoice(facturadorPage);
      // INICIO CREACIón FACTURA
      await facturadorPage
        .locator('select[name="puntoDeVenta"]')
        .selectOption('1');
      await facturadorPage.locator('text=Continuar >').click();

      // Select invoice date
      const today = DateTime.now();
      //TODO ! check if current month is not month of facturation
      const date = getInvoicingDate(); // `${currentDateNumber}/${invoicingMonth}/${today.getFullYear()}`;
      const dateInput = facturadorPage.locator(
        'input[name="fechaEmisionComprobante"]'
      );
      await dateInput.fill('');
      await dateInput.fill(date);

      // Select invoice type
      await facturadorPage
        .locator('select[name="idConcepto"]')
        .selectOption('2'); // Servicios
      await facturadorPage.locator('text=Continuar >').click();

      // Fill invoice header data
      await facturadorPage
        .locator('select[name="idIVAReceptor"]')
        .selectOption('5'); // Consumidor final

      const {invoiceData} = mapInvoiceData(inv);
      const documentType = invoiceData.DocTipo;
      if (!documentType)
        error(
          new Error(
            `Document Type is mandatory and should either be DNI, CUIT or CUIL
            ${inv.TIPO_DOCUMENTO}`
          )
        );

      await facturadorPage
        .locator('select[name="idTipoDocReceptor"]')
        .selectOption(documentType.toString());
      await facturadorPage
        .locator('input[name="nroDocReceptor"]')
        .fill(inv.NUMERO); // completar con DNI/CUIT NUMBER

      const addressInput = facturadorPage.locator(
        'input[name="domicilioReceptor"]'
      );
      if (documentType === DOCUMENT_TYPES.DNI) {
        await facturadorPage
          .locator('input[name="razonSocialReceptor"]')
          .fill(inv.NOMBRE); // Razon social
        await addressInput.fill(inv.CONCEPTO); // domicilio
      } else {
        // a timeout to wait autofill of imputs if CUIT data exists
        await sleep(facturadorPage, 2500);
        const currentValue = await addressInput.getAttribute('value');
        if (!currentValue) {
          await addressInput.fill(inv.CONCEPTO);
        }
      }

      await facturadorPage.locator('#formadepago4').check(); // Forma de pago: cuenta corriente
      await facturadorPage.locator('text=Continuar >').click();

      const description = getInvoiceDescription(inv.CONCEPTO, date)

      // Fill invoice body data
      await addAccomodationDataToInvoice(
        facturadorPage,
        {
          code: inv.COD ? `${inv.COD}` : '001',
          description: description,
          amount: invoiceData.CantReg.toString() || '1',
          value: inv.TOTAL,
        }
      );
      // if (invoiceData.expenses) {
      //   await addExpensesDataToInvoice(facturadorPage, invoiceData.expenses);
      // }
      await facturadorPage.keyboard.press('Tab');
      await sleep(facturadorPage, 100);

      const inputTotalValue = await facturadorPage
        .locator('input[name="impTotal"]')
        .inputValue();

      const totalValue = formatNumber(
        Number(inv.TOTAL)
      );

      if (formatNumber(Number(inputTotalValue)) !== totalValue) {
        console.debug(
          'inputtotalvalue',
          inputTotalValue,
          typeof inputTotalValue
        );
        console.debug('totalvalue', totalValue, typeof totalValue);
        error(new Error(`Total values don't match ${inv.NOMBRE}`));
      } // assert value in the input is equal to total value of invoice

      // TODO! DEBUG UP TO THIS POINT
      if (process.env.DEBUG === 'true') {
        sleep(facturadorPage, 10000);
        return;
      }

      await facturadorPage.locator('text=Continuar >').click();

      // maybe assert document number is correct if not fails?
      await facturadorPage.locator(`text=${inv.NUMERO}`).waitFor();
      // maybe assert total value is correct if not fails?
      await facturadorPage.locator(`b:has-text("${totalValue}")`).waitFor();

      // confirm invoice issuance:
      await facturadorPage.locator('text=Confirmar Datos...').click();
      // Print pdf
      const [download] = await Promise.all([
        facturadorPage.waitForEvent('download'),
        facturadorPage.locator('text=Imprimir...').click(),
      ]);
      await download.saveAs(
        `invoices/factura-${today.year}${today.month}-${inv.NOMBRE}.pdf`
      );
      await download.delete();
      // Click text=Menú Principal

      await facturadorPage.locator('text=Menú Principal').click();

      // if (
      //   !(await page
      //     .url()
      //     .includes('https://fe.afip.gob.ar/rcel/jsp/menu_ppal.jsp'))
      // ) {
      //   error(new Error(`Incorrect page title: ${invoiceData.resident}`));
      // }
      console.debug(`✅ Invoice issued successfully: ${inv.NOMBRE}`);
    }
    await browser.close();
  }
  await main();
})();
