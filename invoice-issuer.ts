import type { Page } from 'playwright';
import type { Columns } from './types/file';
import { DateTime } from 'luxon';
import {
  sleep,
  addAccomodationDataToInvoice,
  formatNumber,
  startNewInvoice,
  getInvoiceDescription,
  getPeriodFromDate,
  getPeriodToDate,
  getCurrentDefaultCode,
} from './functions';
import { mapInvoiceData } from './mappers/invoice-mapper';
import { DOCUMENT_TYPES } from './types/invoice';

//TODO: check why this was used
// const MENU_PPAL_URL = 'https://fe.afip.gob.ar/rcel/jsp/menu_ppal.jsp';
const MENU_PPAL_URL = 'https://monotributo.afip.gob.ar/app/Admin/vRut.aspx';
const PORTAL_MONOTRIBUTO_URL = 'https://monotributo.afip.gob.ar/app/Inicio.aspx';


/**
 * A timeout that can be disarmed so it never rejects. Used with Promise.race
 * so that once the "point of no return" is reached (e.g. server-side invoice
 * submission), the timeout no longer fires and the operation can complete.
 */
export class CancellableTimeout {
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private disarmed = false;
  readonly promise: Promise<never>;

  constructor(ms: number, message: string) {
    this.promise = new Promise<never>((_, reject) => {
      this.timerId = setTimeout(() => {
        if (!this.disarmed) {
          reject(new Error(message));
        }
      }, ms);
    });
  }

  /** Prevents the timeout from ever rejecting. Idempotent. */
  disarm(): void {
    this.disarmed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}

export interface InvoiceRunResult {
  invoice: Columns;
  index: number;
  status: 'success' | 'failed';
  error?: string;
  isTimeout?: boolean;
  duration: number;
}

export interface InvoiceIssuerOptions {
  page: Page;
  getInvoicingDate: () => `${string}/${string}/${string}`;
  timeoutMs?: number;
}

/**
 * Issues AFIP invoices via the facturador page. Tracks success/failure per
 * invoice, supports per-invoice timeout with disarm at point of no return,
 * and optional retry of failed invoices.
 */
export class InvoiceIssuer {
  private results: InvoiceRunResult[] = [];
  private readonly page: Page;
  private readonly getInvoicingDate: () => `${string}/${string}/${string}`;
  private readonly timeoutMs: number;

  constructor(opts: InvoiceIssuerOptions) {
    this.page = opts.page;
    this.getInvoicingDate = opts.getInvoicingDate;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  /**
   * Issues all given invoices. Failed invoices are recorded; the loop
   * continues. Call printSummary() after to see results.
   */
  async issueAll(invoices: Columns[]): Promise<InvoiceRunResult[]> {
    let index = 1;
    for (const inv of invoices) {
      const result = await this.issueWithTimeout(inv, index);
      this.results.push(result);
      if (result.status === 'failed') {
        await this.recoverAfterFailure();
      } else {
        index++;
      }
    }
    return this.results;
  }

  /** Returns only the failed results from the last run(s). */
  getFailedResults(): InvoiceRunResult[] {
    return this.results.filter((r) => r.status === 'failed');
  }

  /**
   * Retries only the invoices that failed in the last issueAll() run.
   * Appends new results to this.results and does not clear previous entries.
   */
  async retryFailed(): Promise<InvoiceRunResult[]> {
    const failed = this.getFailedResults();
    if (failed.length === 0) {
      return this.results;
    }
    const toRetry = failed.map((r) => ({ invoice: r.invoice, index: r.index }));
    for (const { invoice, index } of toRetry) {
      const result = await this.issueWithTimeout(invoice, index);
      this.results.push(result);
      if (result.status === 'failed') {
        await this.recoverAfterFailure();
      }
    }
    return this.results;
  }

  /** Logs a summary of successful and failed invoices to the console. */
  printSummary(): void {
    const successful = this.results.filter((r) => r.status === 'success');
    const failed = this.results.filter((r) => r.status === 'failed');

    console.log('\n========== INVOICE RUN SUMMARY ==========');
    console.log(
      `Total: ${this.results.length} | Success: ${successful.length} | Failed: ${failed.length}`,
    );

    if (successful.length > 0) {
      console.log('\nSuccessful:');
      for (const r of successful) {
        console.log(
          `  - ${r.invoice.NOMBRE} ($${r.invoice.TOTAL}) [${r.duration}ms]`,
        );
      }
    }
    if (failed.length > 0) {
      console.log('\nFailed:');
      for (const r of failed) {
        console.log(
          `  - ${r.invoice.NOMBRE}: ${r.error ?? 'Unknown'}${r.isTimeout ? ' [TIMEOUT]' : ''}`,
        );
      }
    }
    console.log('==========================================\n');
  }

  private async issueWithTimeout(
    inv: Columns,
    index: number,
  ): Promise<InvoiceRunResult> {
    const start = Date.now();
    const timeout = new CancellableTimeout(
      this.timeoutMs,
      `Timeout: invoice ${inv.NOMBRE} exceeded ${this.timeoutMs}ms`,
    );

    try {
      await Promise.race([
        this.issueInvoice(inv, index, timeout),
        timeout.promise,
      ]);
      timeout.disarm();
      return {
        invoice: inv,
        index,
        status: 'success',
        duration: Date.now() - start,
      };
    } catch (e) {
      timeout.disarm();
      const isTimeout =
        e instanceof Error && e.message.startsWith('Timeout:');
      return {
        invoice: inv,
        index,
        status: 'failed',
        error: e instanceof Error ? e.message : 'Unknown error',
        isTimeout,
        duration: Date.now() - start,
      };
    }
  }

  private async recoverAfterFailure(): Promise<void> {
    try {
      await this.page.goto(MENU_PPAL_URL, { timeout: 10_000 });
      await this.page.waitForLoadState('networkidle', { timeout: 10_000 });
    } catch {
      // If recovery fails, the next iteration's startNewInvoice will handle navigation
    }
  }

  private async issueInvoice(
    inv: Columns,
    index: number,
    timeout: CancellableTimeout,
  ): Promise<void> {
    await sleep(this.page, 1000);
    console.debug(`⏳ Issuing ${inv.NOMBRE} invoice for ${inv.TOTAL} ...`);
    await startNewInvoice(this.page);

    await this.page.locator('select[name="puntoDeVenta"]').selectOption('1');
    await this.page.locator('text=Continuar >').click();

    const today = DateTime.now();
    const date = this.getInvoicingDate();
    const dateInput = this.page.locator(
      'input[name="fechaEmisionComprobante"]',
    );
    await dateInput.fill('');
    await dateInput.fill(date);

    await this.page
      .locator('select[name="idConcepto"]')
      .selectOption('2'); // Servicios

    const fromDateInput = this.page.locator(
      'input[name="periodoFacturadoDesde"]',
    );
    await fromDateInput.fill('');
    await fromDateInput.fill(getPeriodFromDate(date));

    const toDateInput = this.page.locator(
      'input[name="periodoFacturadoHasta"]',
    );
    await toDateInput.fill('');
    await toDateInput.fill(getPeriodToDate(date));

    const deadlineDateInput = this.page.locator(
      'input[name="vencimientoPago"]',
    );
    await deadlineDateInput.fill('');
    await deadlineDateInput.fill(getPeriodToDate(date));

    await this.page.locator('text=Continuar >').click();

    await this.page
      .locator('select[name="idIVAReceptor"]')
      .selectOption('5'); // Consumidor final

    const { invoiceData } = mapInvoiceData(inv);
    const documentType = invoiceData.DocTipo;
    if (!documentType) {
      throw new Error(
        `Document Type is mandatory and should either be DNI, CUIT or CUIL ${inv.TIPO_DOCUMENTO}`,
      );
    }

    await this.page
      .locator('select[name="idTipoDocReceptor"]')
      .selectOption(documentType.toString());
    await this.page.locator('input[name="nroDocReceptor"]').fill(inv.NUMERO);

    const addressInput = this.page.locator('input[name="domicilioReceptor"]');

    if (documentType === DOCUMENT_TYPES.DNI) {
      await this.page
        .locator('input[name="razonSocialReceptor"]')
        .fill(inv.NOMBRE);
      await addressInput.fill(inv.CONCEPTO);
    } else {
      await this.page.waitForLoadState('networkidle');
      const currentValue = await addressInput.inputValue();
      const isEditable = await addressInput.isEditable();
      if (!currentValue && isEditable) {
        if (inv.DOMICILIO) {
          await addressInput.fill(inv.DOMICILIO);
        } else {
          throw new Error(`DOMICILIO is required for ${inv.NOMBRE}`);
        }
      }
    }

    await this.page.locator('#formadepago4').check();
    await this.page.locator('text=Continuar >').click();

    const description = getInvoiceDescription(inv.CONCEPTO, date);

    await addAccomodationDataToInvoice(this.page, {
      code: inv.COD ? `${inv.COD}` : getCurrentDefaultCode(index),
      description,
      amount: invoiceData.CantReg.toString() || '1',
      value: inv.TOTAL,
    });
    await this.page.keyboard.press('Tab');
    await sleep(this.page, 100);

    const inputTotalValue = await this.page
      .locator('input[name="impTotal"]')
      .inputValue();
    const totalValue = formatNumber(Number(inv.TOTAL));

    if (formatNumber(Number(inputTotalValue)) !== totalValue) {
      throw new Error(`Total values don't match ${inv.NOMBRE}`);
    }

    if (process.env.DEBUG === 'true') {
      await sleep(this.page, 10_000);
      return;
    }

    // Point of no return: disarm timeout so server-side issuance is not interrupted
    timeout.disarm();
    await this.page.locator('text=Continuar >').click();

    await this.page.locator(`text=${inv.NUMERO}`).waitFor();
    await this.page.locator(`b:has-text("${totalValue}")`).waitFor();

    await this.page.locator('text=Confirmar Datos...').click();

    const confirmDialog = this.page.locator(
      '.ui-dialog:has-text("Generar Comprobante")',
    );
    const confirmButton = confirmDialog.locator(
      '.ui-dialog-buttonset button:has-text("Confirmar")',
    );
    try {
      await confirmButton.click({ timeout: 3000 });
    } catch {
      // Popup didn't appear, continue normally
    }

    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.locator('text=Imprimir...').click(),
    ]);
    await download.saveAs(
      `invoices/factura-${today.year}${today.month}-${inv.NOMBRE}.pdf`,
    );
    await download.delete();

    await this.page.locator('text=Menú Principal').click();
    console.debug(`✅ Invoice issued successfully: ${inv.NOMBRE}`);
  }
}
