import type { Locator, Page } from 'playwright';
import type { Columns } from './types/file';
import { COLUMNS_ORDER } from './types/file';
import { DateTime, Duration } from 'luxon';
import * as XLSX from 'xlsx';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  sleep,
  addAccomodationDataToInvoice,
  formatCurrency,
  formatNumber,
  startNewInvoice,
  getInvoiceDescription,
  getPeriodFromDate,
  getPeriodToDate,
  getCurrentDefaultCode,
} from './functions';
import { mapInvoiceData } from './mappers/invoice-mapper';
import { DOCUMENT_TYPES } from './types/invoice';

interface SelectOptionItem {
  index: number;
  value: string;
  text: string;
}

export interface SaveSummaryOptions {
  /** Output format. Default: 'csv'. */
  format?: 'csv' | 'xlsx';
  /** Include successful rows. Default: true. */
  includeSuccess?: boolean;
  /** Include failed rows (e.g. for rerun). Default: true. */
  includeFailed?: boolean;
  /** Output path. If omitted, generates invoices/run-summary-{timestamp}.{csv|xlsx}. */
  path?: string;
}

/**
 * Serializes a Columns row to a string record suitable for CSV/XLSX output
 * using the same column schema as input (so the file can be re-fed later).
 */
function columnsToSerializable(row: Columns): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of COLUMNS_ORDER) {
    const v = row[key];
    if (v === null || v === undefined) {
      out[key] = '';
    } else if (v instanceof Date) {
      out[key] = DateTime.fromJSDate(v).toFormat('dd/MM/yyyy');
    } else if (typeof v === 'number') {
      out[key] = String(v);
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

function escapeCsvField(value: string): string {
  if (!/[\n",]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function sanitizePathSegment(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics (á→a, ñ→n, etc.)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')      // remove anything that isn't alphanumeric, space, or hyphen
    .trim()
    .replace(/[\s-]+/g, '-')           // collapse spaces and hyphens into a single hyphen
    .replace(/^-+|-+$/g, '')           // strip leading/trailing hyphens
    .slice(0, 120);
}

function classifyFailureCode(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('timeout')) return 'TIMEOUT';
  if (normalized.includes('domicilio')) return 'RECEIVER_ADDRESS';
  if (normalized.includes('puntodeventa')) return 'POINT_OF_SALE';
  if (normalized.includes('idtipodocreceptor') || normalized.includes('document type')) return 'DOCUMENT_TYPE';
  if (normalized.includes('comprobante')) return 'INVOICE_TYPE';
  if (normalized.includes('total values')) return 'TOTAL_MISMATCH';
  return 'UNKNOWN';
}

//TODO: check why this was used
// const MENU_PPAL_URL = 'https://monotributo.afip.gob.ar/app/Admin/vRut.aspx';
const MENU_PPAL_URL = 'https://fe.afip.gob.ar/rcel/jsp/menu_ppal.jsp';
// const PORTAL_MONOTRIBUTO_URL = 'https://monotributo.afip.gob.ar/app/Inicio.aspx';


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
  failureCode?: string;
  artifactPath?: string;
  issuedDate?: `${string}/${string}/${string}`;
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

  /** Returns only the successful results from the last run(s). */
  getSuccessResults(): InvoiceRunResult[] {
    return this.results.filter((r) => r.status === 'success');
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
          `  - ${r.invoice.NOMBRE} (${formatCurrency(Number(r.invoice.TOTAL))}) [${Duration.fromMillis(r.duration).toFormat("m'm' s's'")}]`,
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

  /**
   * Writes success and/or failed rows to a CSV or XLSX file using the same
   * column schema as input, so the file can be re-fed (e.g. to rerun failed only).
   *
   * @param opts - Format, which rows to include, and output path.
   * @returns The path of the written file (or the first path if two files written).
   */
  async saveSummaryToFile(opts: SaveSummaryOptions = {}): Promise<string> {
    const format = opts.format ?? 'csv';
    const includeSuccess = opts.includeSuccess ?? false;
    const includeFailed = opts.includeFailed ?? true;
    const ext = format === 'xlsx' ? '.xlsx' : '.csv';
    const timestamp = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
    const defaultPath = `invoices/run-summary-${timestamp}${ext}`;
    const basePath = opts.path ?? defaultPath;
    const pathWithExt = basePath.endsWith(ext) ? basePath : `${basePath.replace(/\.[^.]+$/, '')}${ext}`;

    const successResults = this.results.filter((r) => r.status === 'success');
    const failedResults = this.results.filter((r) => r.status === 'failed');

    const rowsToWrite: { result: InvoiceRunResult; addStatus: boolean }[] = [];
    if (includeSuccess) {
      for (const r of successResults) {
        rowsToWrite.push({ result: r, addStatus: includeSuccess && includeFailed });
      }
    }
    if (includeFailed) {
      for (const r of failedResults) {
        rowsToWrite.push({ result: r, addStatus: includeSuccess && includeFailed });
      }
    }

    if (rowsToWrite.length === 0) {
      console.debug('saveSummaryToFile: no rows to write');
      return pathWithExt;
    }

    const addStatusColumn = includeSuccess && includeFailed;
    const headers = addStatusColumn ? [...COLUMNS_ORDER, 'STATUS'] : COLUMNS_ORDER;
    const serialized = rowsToWrite.map(({ result, addStatus }) => {
      const row = columnsToSerializable(result.invoice);
      if (addStatus) {
        row['STATUS'] = result.status;
      }
      return row;
    });

    if (format === 'csv') {
      const headerLine = headers.map((h) => escapeCsvField(h)).join(',');
      const dataLines = serialized.map((row) =>
        headers.map((h) => escapeCsvField(row[h] ?? '')).join(','),
      );
      const csv = [headerLine, ...dataLines].join('\n');
      await mkdir(dirname(pathWithExt), { recursive: true });
      await writeFile(pathWithExt, csv, 'utf8');
    } else {
      const worksheet = XLSX.utils.json_to_sheet(serialized, {
        header: headers as string[],
      });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary');
      XLSX.writeFile(workbook, pathWithExt, { bookType: 'xlsx' });
    }

    const metadataPath = `${pathWithExt.replace(/\.[^.]+$/, '')}.meta.json`;
    const metadata = {
      generatedAt: DateTime.now().toISO(),
      summaryPath: pathWithExt,
      format,
      includeSuccess,
      includeFailed,
      totals: {
        total: this.results.length,
        success: successResults.length,
        failed: failedResults.length,
      },
      rows: this.results.map((result) => ({
        index: result.index,
        status: result.status,
        name: result.invoice.NOMBRE,
        document: result.invoice.NUMERO,
        total: result.invoice.TOTAL,
        durationMs: result.duration,
        error: result.error,
        failureCode: result.failureCode,
        isTimeout: result.isTimeout ?? false,
        artifactPath: result.artifactPath,
        issuedDate: result.issuedDate,
      })),
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    console.debug(`Summary written to ${pathWithExt} (${rowsToWrite.length} rows), metadata: ${metadataPath}`);
    return pathWithExt;
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
      const issueDetails = await Promise.race([
        this.issueInvoice(inv, index, timeout),
        timeout.promise,
      ]);
      timeout.disarm();
      return {
        invoice: inv,
        index,
        status: 'success',
        duration: Date.now() - start,
        artifactPath: issueDetails.artifactPath,
        issuedDate: issueDetails.issuedDate,
      };
    } catch (e) {
      timeout.disarm();
      const isTimeout =
        e instanceof Error && e.message.startsWith('Timeout:');
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.error(`❌ Invoice failed: ${inv.NOMBRE}`, e);
      return {
        invoice: inv,
        index,
        status: 'failed',
        error: errorMessage,
        isTimeout,
        failureCode: classifyFailureCode(errorMessage),
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
  ): Promise<{ artifactPath: string; issuedDate: `${string}/${string}/${string}` }> {
    const start = performance.now();
    await sleep(this.page, 1000);
    console.debug(`[${index}] ⏳ Issuing ${inv.NOMBRE} invoice for ${inv.TOTAL} ...`);
    await startNewInvoice(this.page);

    await this.selectPointOfSale();
    await this.selectInvoiceType(inv.FACTURA_TIPO);
    await this.page.locator('text=Continuar >').click();

    const today = DateTime.now();
    const date = this.resolveInvoiceDate(inv.FECHA_EMISION as string | undefined);
    const dateInput = this.page.locator(
      'input[name="fechaEmisionComprobante"]',
    );
    await dateInput.fill('');
    await dateInput.fill(date);

    await this.page
      .locator('select[name="idConcepto"]')
      .selectOption('2'); // Servicios

    await this.selectAssociatedActivityIfPresent();

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

    const { invoiceData } = mapInvoiceData(inv);
    const documentType = invoiceData.DocTipo;
    if (!documentType) {
      throw new Error(
        `Document Type is mandatory and should either be DNI, CUIT or CUIL ${inv.TIPO_DOCUMENTO}`,
      );
    }

    const ivaReceiverSelect = this.page.locator('select[name="idIVAReceptor"]');
    await ivaReceiverSelect.waitFor({ state: 'visible' });
    const ivaOptions = await this.waitForSelectableOptions(ivaReceiverSelect);
    // AFIP usually requires "Consumidor final" when customer document type is DNI.
    const requestedIva = documentType === DOCUMENT_TYPES.DNI
      ? '5'
      : String(invoiceData.CondicionIVAReceptorId);
    const matchedIva = ivaOptions.find((option) => option.value === requestedIva);
    if (matchedIva) {
      await ivaReceiverSelect.selectOption({ index: matchedIva.index });
    } else {
      await ivaReceiverSelect.selectOption({ index: ivaOptions[0]!.index });
    }

    await this.selectReceiverDocumentType(documentType, inv.TIPO_DOCUMENTO);
    const receiverDocInput = this.page.locator('input[name="nroDocReceptor"]').first();
    await receiverDocInput.fill(inv.NUMERO);
    await this.triggerReceiverDocumentBlur(receiverDocInput);

    if (documentType === DOCUMENT_TYPES.DNI) {
      await this.page
        .locator('input[name="razonSocialReceptor"]')
        .fill(inv.NOMBRE);
    }
    await this.fillReceiverAddress(documentType, inv);

    // check if this works to await the page to be ready
    await sleep(this.page, 200);

    await this.selectPaymentMethod(inv.METODO_PAGO);
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
      timeout.disarm();
      const end = performance.now();
      console.debug(`[${index}] Invoice not issued due to DEBUG mode: ${inv.NOMBRE} in${DateTime.fromMillis(end - start).toFormat('ss.SSS')} seconds `);
      await sleep(this.page, 10_000);
      return {
        artifactPath: '',
        issuedDate: date,
      };
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
    const safeName = sanitizePathSegment(inv.NOMBRE || `invoice-${index}`);
    const shortHash = Math.random().toString(16).slice(2, 6);
    const outputPdfPath = `invoices/factura-${today.year}${String(today.month).padStart(2, '0')}-${safeName}-${index}-${shortHash}.pdf`;
    await download.saveAs(outputPdfPath);
    await download.delete();

    await this.page.locator('text=Menú Principal').click();
    const end = performance.now();
    console.debug(`[${index}] ✅ Invoice issued successfully: ${inv.NOMBRE} in ${DateTime.fromMillis(end - start).toFormat('ss.SSS')} seconds `);
    return {
      artifactPath: outputPdfPath,
      issuedDate: date,
    };
  }

  private resolveInvoiceDate(
    csvIssueDate?: string | null,
  ): `${string}/${string}/${string}` {
    const raw = csvIssueDate?.trim();
    if (raw) {
      const parsed = DateTime.fromFormat(raw, 'dd/MM/yyyy');
      if (parsed.isValid) {
        return parsed.toFormat('dd/MM/yyyy') as `${string}/${string}/${string}`;
      }
    }

    return this.getInvoicingDate();
  }

  private async selectPointOfSale(): Promise<void> {
    const pointOfSaleSelect = this.page.locator('select[name="puntoDeVenta"]');
    await pointOfSaleSelect.waitFor({ state: 'visible' });
    const selectableOptions = await this.waitForSelectableOptions(pointOfSaleSelect);

    const requestedPointOfSale = process.env.POINT_OF_SALE?.trim();
    if (!requestedPointOfSale || requestedPointOfSale === '1') {
      await pointOfSaleSelect.selectOption({ index: selectableOptions[0]!.index });
      return;
    }

    const matchedOption = selectableOptions.find(
      (option) => option.value === requestedPointOfSale,
    );
    if (!matchedOption) {
      throw new Error(
        `Requested puntoDeVenta "${requestedPointOfSale}" was not found. Available options: ${selectableOptions.map((option) => option.value).join(', ')}`,
      );
    }

    await pointOfSaleSelect.selectOption({ index: matchedOption.index });
  }

  private async selectInvoiceType(
    invoiceType?: string | null,
  ): Promise<void> {
    const candidates = [
      'select[name="universoComprobante"]',
      'select[name="tipoComprobante"]',
      'select#universoComprobante',
      'select#tipoComprobante',
    ];

    let selectLocator: Locator | null = null;
    for (const selector of candidates) {
      const locator = this.page.locator(selector);
      if ((await locator.count()) > 0) {
        selectLocator = locator.first();
        break;
      }
    }

    if (!selectLocator) {
      return;
    }

    await selectLocator.waitFor({ state: 'visible' });
    const selectableOptions = await this.waitForSelectableOptions(selectLocator);

    if (!invoiceType) {
      await selectLocator.selectOption({ index: selectableOptions[0]!.index });
      return;
    }

    const normalizedInvoiceType = invoiceType.trim().toUpperCase();
    const matchedOption = selectableOptions.find((option) => {
      const normalizedText = option.text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
      return normalizedText.includes(`FACTURA ${normalizedInvoiceType}`);
    });

    if (!matchedOption) {
      throw new Error(
        `Requested comprobante type "${invoiceType}" was not found. Available options: ${selectableOptions.map((option) => option.text).join(', ')}`,
      );
    }

    await selectLocator.selectOption({ index: matchedOption.index });
  }

  private async selectAssociatedActivityIfPresent(): Promise<void> {
    const candidates = [
      'select[name="actiAsociadaId"]',
      'select[name="idActividadAsociada"]',
      'select[name="idActividad"]',
      'select#actiAsociadaId',
      'select#idActividadAsociada',
      'select#idActividad',
    ];

    let activitySelect: Locator | null = null;
    for (const selector of candidates) {
      const locator = this.page.locator(selector);
      if ((await locator.count()) > 0) {
        activitySelect = locator.first();
        break;
      }
    }
    if (!activitySelect) {
      return;
    }

    try {
      await activitySelect.waitFor({ state: 'visible', timeout: 5000 });
      const options = await this.waitForSelectableOptions(activitySelect, 10_000);
      await activitySelect.selectOption({ index: options[0]!.index });
    } catch {
      // Activity can be optional or delayed depending on taxpayer profile.
    }
  }

  private async selectPaymentMethod(paymentMethodRaw?: string | null): Promise<void> {
    const desiredRaw = (paymentMethodRaw ?? '').trim();
    const desired = desiredRaw.length > 0 ? desiredRaw : 'otros';
    const normalizedDesired = desired
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const optionInputs = this.page.locator(
      'input[id^="formadepago"][type="radio"], input[id^="formadepago"][type="checkbox"], input[name*="forma"][type="radio"], input[name*="forma"][type="checkbox"]',
    );
    const optionCount = await optionInputs.count();
    if (optionCount === 0) {
      // Legacy fallback used previously in this project.
      await this.page.locator('#formadepago4').check();
      return;
    }

    const options = await optionInputs.evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const element = node as {
          id?: string;
          name?: string;
          value?: string;
          closest?: (selector: string) => { textContent?: string | null } | null;
          ownerDocument?: {
            querySelector?: (selector: string) => { textContent?: string | null } | null;
          };
        };
        const id = element.id ?? '';
        const labelByFor = id && element.ownerDocument?.querySelector
          ? element.ownerDocument.querySelector(`label[for="${id}"]`)?.textContent ?? ''
          : '';
        const closestLabel = element.closest ? element.closest('label')?.textContent ?? '' : '';
        const rowText = element.closest ? element.closest('tr')?.textContent ?? '' : '';

        return {
          index,
          id,
          name: element.name ?? '',
          value: element.value ?? '',
          text: `${labelByFor} ${closestLabel} ${rowText}`.replace(/\s+/g, ' ').trim(),
        };
      }),
    );

    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const isTransfer = normalizedDesired.includes('transfer');
    const isOther = normalizedDesired.includes('otro');

    let matched = options.find((option) => {
      const normalizedOption = normalize(`${option.text} ${option.value}`);
      if (isTransfer) return normalizedOption.includes('transfer');
      if (isOther) return normalizedOption.includes('otro');
      return normalizedOption.includes(normalizedDesired);
    });

    if (!matched) {
      matched = options.find((option) => normalize(`${option.text} ${option.value}`).includes('otro'));
    }
    if (!matched) {
      matched = options[0];
    }
    if (!matched) {
      throw new Error('No payment method options available in AFIP form');
    }

    if (matched.id) {
      await this.page.locator(`#${matched.id}`).check();
    } else {
      await optionInputs.nth(matched.index).check();
    }
  }

  private async fillReceiverAddress(
    documentType: number,
    inv: Columns,
  ): Promise<void> {
    const inputCandidates = [
      'input[name="domicilioReceptor"]',
      'input[name="domicilio"]',
      'input[id*="domicilio"]',
    ];
    const selectCandidates = [
      'select[name="domicilioReceptor"]',
      'select[name="domicilio"]',
      'select[id*="domicilio"]',
    ];

    const addressInput = this.page.locator(inputCandidates.join(', ')).first();
    const addressSelect = this.page.locator(selectCandidates.join(', ')).first();
    const normalizedAddress = inv.DOMICILIO?.trim();

    if (documentType === DOCUMENT_TYPES.DNI) {
      if (!normalizedAddress) {
        throw new Error(`DOMICILIO is required for ${inv.NOMBRE}`);
      }
      await addressInput.waitFor({ state: 'visible' });
      let persisted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        await addressInput.fill('');
        await addressInput.fill(normalizedAddress);
        await addressInput.press('Tab');
        await this.page.waitForTimeout(250);
        const currentValue = (await addressInput.inputValue()).trim();
        if (currentValue.length > 0) {
          persisted = true;
          break;
        }
      }
      if (!persisted) {
        throw new Error(`Could not persist DOMICILIO for ${inv.NOMBRE}`);
      }
      return;
    }

    await this.page.waitForLoadState('networkidle');

    if ((await addressSelect.count()) > 0) {
      const options = await this.waitForSelectableOptions(addressSelect);
      const currentValue = await addressSelect.inputValue();
      if (!currentValue) {
        if (normalizedAddress) {
          const normalizedExpected = normalizedAddress
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
          const matched = options.find((option) =>
            option.text
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toUpperCase()
              .includes(normalizedExpected),
          );
          if (matched) {
            await addressSelect.selectOption({ index: matched.index });
            return;
          }
        }
        await addressSelect.selectOption({ index: options[0]!.index });
      }
      return;
    }

    if ((await addressInput.count()) > 0) {
      const currentValue = await addressInput.inputValue();
      const isEditable = await addressInput.isEditable();
      if (!currentValue && isEditable) {
        if (!normalizedAddress) {
          throw new Error(`DOMICILIO is required for ${inv.NOMBRE}`);
        }
        await addressInput.fill(normalizedAddress);
      }
    }
  }

  private async selectReceiverDocumentType(
    documentType: number,
    documentLabelRaw: string,
  ): Promise<void> {
    const documentTypeSelect = this.page.locator('select[name="idTipoDocReceptor"]').first();
    await documentTypeSelect.waitFor({ state: 'visible' });
    const options = await this.waitForSelectableOptions(documentTypeSelect, 30_000);

    const requestedValue = String(documentType);
    const normalizedLabel = documentLabelRaw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();

    const matched = options.find((option) => {
      const normalizedOptionText = option.text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
      return option.value === requestedValue || normalizedOptionText.includes(normalizedLabel);
    });

    if (!matched) {
      throw new Error(
        `Receiver document type "${documentLabelRaw}" (${requestedValue}) not available. Options: ${options.map((option) => `${option.value}:${option.text}`).join(', ')}`,
      );
    }

    await documentTypeSelect.selectOption({ index: matched.index });
  }

  private async triggerReceiverDocumentBlur(input: Locator): Promise<void> {
    await input.evaluate((element) => {
      const field = element as {
        dispatchEvent: (event: Event) => boolean;
        blur: () => void;
      };
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      field.blur();
      field.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    try {
      await this.page.waitForLoadState('networkidle', { timeout: 4000 });
    } catch {
      // Not every AFIP profile triggers a request on blur.
    }
    await this.page.waitForTimeout(250);
  }

  private async waitForSelectableOptions(
    selectLocator: Locator,
    timeoutMs = 20_000,
  ): Promise<SelectOptionItem[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const options = await selectLocator.locator('option').evaluateAll((nodes) =>
        nodes.map((node, index) => {
          const option = node as { value?: string; textContent?: string | null };
          return {
            index,
            value: option.value?.trim() ?? '',
            text: option.textContent?.replace(/\u00a0/g, ' ').trim() ?? '',
          };
        }),
      );

      const selectable = options.filter((option) => option.value.length > 0);
      if (selectable.length > 0) {
        return selectable;
      }
      await this.page.waitForTimeout(300);
    }

    throw new Error('No selectable options found in dropdown after waiting for dynamic load');
  }
}
