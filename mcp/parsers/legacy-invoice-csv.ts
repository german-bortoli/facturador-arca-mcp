import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
import { ColumnsSchema, parseIvaExentoValue, type Columns } from '../../types/file';
import {
  cleanDocumentNumber,
  resolveIvaReceiverCode,
  VALID_IVA_RECEIVER_CODES,
} from '../../utils/data-cleaner';

const LEGACY_HEADER_ALIASES: Record<string, string> = {
  MES: 'MES',
  COMPROBANTE: 'COMPROBANTE',
  NCOMP: 'NCOMP',
  NROCOMP: 'NCOMP',
  FECHA: 'FECHA',
  MATRICULA: 'MATRICULA',
  HOSPEDAJE: 'HOSPEDAJE',
  SERVICIOS: 'SERVICIOS',
  TOTAL: 'TOTAL',
  PAGADOR: 'PAGADOR',
  NOMBRE: 'PAGADOR',
  RESIDENTE: 'RESIDENTE',
  TIPODOC: 'TIPO_DOC',
  TIPODOCUMENTO: 'TIPO_DOC',
  DOCUMENTO: 'DOCUMENTO',
  NRODOCUMENTO: 'DOCUMENTO',
  DIRECCION: 'DIRECCION',
  CONCEPTO: 'CONCEPTO',
  COD: 'COD',
  METODOPAGO: 'METODO_PAGO',
  FORMAPAGO: 'METODO_PAGO',
  FORMADEPAGO: 'METODO_PAGO',
  CONDICIONDEVENTA: 'METODO_PAGO',
  FECHASERVICIODESDE: 'FECHA_SERVICIO_DESDE',
  PERIODODESDE: 'FECHA_SERVICIO_DESDE',
  FECHASERVICIOHASTA: 'FECHA_SERVICIO_HASTA',
  PERIODOHASTA: 'FECHA_SERVICIO_HASTA',
  FECHAVTOPAGO: 'FECHA_VTO_PAGO',
  IVAGRAVADO: 'IVA_GRAVADO',
  IVAEXCEMPT: 'IVA_EXENTO',
  IVAEXEMPT: 'IVA_EXENTO',
  IVAEXENTO: 'IVA_EXENTO',
  IVAPERCENTAGE: 'IVA_PERCENTAGE',
  PORCENTAJEIVA: 'IVA_PERCENTAGE',
  ALICUOTAIVA: 'IVA_PERCENTAGE',
  CONDICIONIVARECEPTOR: 'IVA_RECEIVER',
  CONDICIONIVA: 'IVA_RECEIVER',
  IVARECEPTOR: 'IVA_RECEIVER',
  IVARECEIVER: 'IVA_RECEIVER',
  FACTURATIPO: 'FACTURA_TIPO',
};

/**
 * Schema-canonical header names accepted as FALLBACK aliases only: they apply
 * when the legacy canonical header is absent. Applying them unconditionally
 * would let e.g. a NUMERO column (often the comprobante number in legacy
 * files) silently overwrite the receiver DOCUMENTO.
 */
const LEGACY_FALLBACK_ALIASES: Record<string, string> = {
  NUMERO: 'DOCUMENTO',
  DOMICILIO: 'DIRECCION',
  FECHAEMISION: 'FECHA',
  VENCIMIENTOPAGO: 'FECHA_VTO_PAGO',
  CONDICIONVENTA: 'METODO_PAGO',
};

const REQUIRED_LEGACY_HEADERS = ['TOTAL'] as const;

/**
 * Receiver-identification headers. Optional since Consumidor Final sin
 * identificar is supported: when absent (or empty per row) the invoice is
 * issued with DocTipo 99 / DocNro 0 and receiver condition 5.
 */
const RECEIVER_ID_HEADERS = ['PAGADOR', 'TIPO_DOC', 'DOCUMENTO'] as const;

const IDENTIFIED_DOC_TYPES = new Set(['CUIT', 'CUIL', 'DNI']);

export interface LegacyInvoiceParseError {
  rowNumber: number;
  error: string;
  row: Record<string, unknown>;
}

export interface LegacyInvoiceParseWarning {
  /** 1-based CSV line (header = 1). Null for file-level warnings. */
  rowNumber: number | null;
  message: string;
}

export interface LegacyInvoiceParseResult {
  valid: Columns[];
  /** 1-based CSV line of each valid row (header = 1), parallel to `valid`. */
  validRowNumbers: number[];
  invalid: LegacyInvoiceParseError[];
  /** Non-fatal notes: values that will be defaulted, corrected or ignored. */
  warnings: LegacyInvoiceParseWarning[];
  /**
   * False when the CSV has neither TIPO_DOC nor DOCUMENTO headers: every row
   * can only be emitted as Consumidor Final sin identificar. Emission gates
   * on this to require an explicit opt-in.
   */
  hasReceiverIdentificationHeaders: boolean;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .trim();
}

function mapLegacyRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const fallbacks: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    const fallbackTarget = LEGACY_FALLBACK_ALIASES[normalized];
    if (fallbackTarget !== undefined && LEGACY_HEADER_ALIASES[normalized] === undefined) {
      fallbacks.push([fallbackTarget, value]);
      mapped[normalized] = value;
      continue;
    }
    const mappedHeader = LEGACY_HEADER_ALIASES[normalized] ?? normalized;
    mapped[mappedHeader] = value;
  }
  // Fallback aliases never overwrite a value provided by a canonical header.
  for (const [target, value] of fallbacks) {
    if (mapped[target] === undefined) {
      mapped[target] = value;
    }
  }
  return mapped;
}

/**
 * File-level warnings for headers whose fallback alias is ignored because the
 * canonical header is also present (e.g. NUMERO alongside DOCUMENTO).
 */
function collectHeaderCollisionWarnings(
  rawRows: Record<string, unknown>[],
  warnings: LegacyInvoiceParseWarning[],
): void {
  const firstRow = rawRows[0];
  if (!firstRow) return;

  const normalizedHeaders = Object.keys(firstRow).map(normalizeHeader);
  const primaryTargets = new Set(
    normalizedHeaders
      .map((header) => LEGACY_HEADER_ALIASES[header])
      .filter((target): target is string => target !== undefined),
  );

  for (const header of normalizedHeaders) {
    const fallbackTarget = LEGACY_FALLBACK_ALIASES[header];
    if (fallbackTarget !== undefined && primaryTargets.has(fallbackTarget)) {
      warnings.push({
        rowNumber: null,
        message:
          `La columna "${header}" se ignora porque el archivo ya tiene la columna canónica que mapea a ${fallbackTarget}. ` +
          'Eliminá una de las dos para evitar ambigüedad.',
      });
    }
  }
}

function assertRequiredHeaders(rows: Record<string, unknown>[]): void {
  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = REQUIRED_LEGACY_HEADERS.filter((header) => !headers.has(header));
  if (missing.length > 0) {
    throw new Error(`Legacy CSV is missing required headers: ${missing.join(', ')}`);
  }
}

/**
 * File-level heads-up when the CSV has no receiver-identification columns at
 * all: every row will be issued as Consumidor Final sin identificar.
 * A file that has TIPO_DOC or DOCUMENTO can still identify receivers, so the
 * fallback message would mislead there (PAGADOR alone missing never causes
 * the Consumidor Final fallback: identified rows fail on NOMBRE instead).
 */
function collectMissingReceiverHeaderWarnings(
  rows: Record<string, unknown>[],
  warnings: LegacyInvoiceParseWarning[],
): void {
  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  if (headers.has('TIPO_DOC') || headers.has('DOCUMENTO')) {
    return;
  }
  const missing = RECEIVER_ID_HEADERS.filter((header) => !headers.has(header));
  warnings.push({
    rowNumber: null,
    message:
      `El CSV no tiene columnas ${missing.join(', ')}: las filas sin identificación del receptor ` +
      'se emiten como Consumidor Final sin identificar (DocTipo 99, DocNro 0, condición IVA 5).',
  });
}

function parseLegacyInvoiceType(rawComprobante: unknown): 'A' | 'B' | 'C' | undefined {
  const normalized = String(rawComprobante ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!normalized) return undefined;
  if (normalized === 'A' || normalized.includes('FACTURA A')) return 'A';
  if (normalized === 'B' || normalized.includes('FACTURA B')) return 'B';
  if (normalized === 'C' || normalized.includes('FACTURA C') || normalized === 'FACTURA') return 'C';
  return undefined;
}

/**
 * Detects comprobante types that AFIP supports but this issuer does not
 * (credit/debit notes, receipts). These must be a hard row error: silently
 * issuing them as Factura C would produce a legally different document.
 */
function detectUnsupportedComprobante(rawComprobante: string): string | undefined {
  const normalized = rawComprobante
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Collapse separators ('/', '.', '-', spaces) so "N/C", "N.C." and "N-C"
    // all normalize to "N C".
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  if (!normalized) return undefined;
  if (/\bNOTA (DE )?CREDITO\b/.test(normalized) || /^N ?C\b/.test(normalized)) return 'Nota de Cr\u00e9dito';
  if (/\bNOTA (DE )?DEBITO\b/.test(normalized) || /^N ?D\b/.test(normalized)) return 'Nota de D\u00e9bito';
  if (/^RECIBO/.test(normalized)) return 'Recibo';
  return undefined;
}

function parseLegacyIssueDate(rawDate: unknown): string | undefined {
  const normalized = String(rawDate ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    // Reject impossible calendar dates (e.g. 31/02/2026) that match the shape.
    return DateTime.fromFormat(normalized, 'dd/MM/yyyy').isValid ? normalized : undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const parsed = DateTime.fromFormat(normalized, 'yyyy-MM-dd');
    if (parsed.isValid) {
      return parsed.toFormat('dd/MM/yyyy');
    }
  }
  return undefined;
}

function buildLegacyConcept(mappedRow: Record<string, unknown>): string {
  const explicitConcept = String(mappedRow.CONCEPTO ?? '').trim();
  if (explicitConcept.length > 0) {
    return explicitConcept;
  }

  const matricula = String(mappedRow.MATRICULA ?? '').trim();
  const resident = String(mappedRow.RESIDENTE ?? '').trim();
  const month = String(mappedRow.MES ?? '').trim();
  const hasServices = String(mappedRow.SERVICIOS ?? '').trim().length > 0;

  const baseConcept = matricula.length > 0
    ? `Matricula de inscripcion ${matricula}${resident ? ` - ${resident}` : ''}`
    : `Servicio de hospedaje${month ? ` ${month}` : ''}${resident ? ` - ${resident}` : ''}`;

  if (!hasServices) {
    return baseConcept;
  }
  return `${baseConcept} + Gastos administrativos`;
}

function toSchemaInput(mappedRow: Record<string, unknown>): Record<string, unknown> {
  return {
    NOMBRE: String(mappedRow.PAGADOR ?? '').trim(),
    DOMICILIO: String(mappedRow.DIRECCION ?? '').trim() || undefined,
    TIPO_DOCUMENTO: String(mappedRow.TIPO_DOC ?? '').trim(),
    NUMERO: String(mappedRow.DOCUMENTO ?? '').trim(),
    CONCEPTO: buildLegacyConcept(mappedRow),
    COD: String(mappedRow.COD ?? '').trim() || undefined,
    METODO_PAGO: String(mappedRow.METODO_PAGO ?? '').trim() || undefined,
    TOTAL: String(mappedRow.TOTAL ?? '').trim(),
    FECHA_EMISION: parseLegacyIssueDate(mappedRow.FECHA),
    FACTURA_TIPO:
      parseLegacyInvoiceType(mappedRow.COMPROBANTE) ??
      parseLegacyInvoiceType(mappedRow.FACTURA_TIPO),
    IVA_GRAVADO: String(mappedRow.IVA_GRAVADO ?? '').trim() || undefined,
    IVA_EXENTO: String(mappedRow.IVA_EXENTO ?? '').trim() || undefined,
    IVA_PERCENTAGE: String(mappedRow.IVA_PERCENTAGE ?? '').trim() || undefined,
    IVA_RECEIVER: String(mappedRow.IVA_RECEIVER ?? '').trim() || undefined,
    FECHA_SERVICIO_DESDE:
      parseLegacyIssueDate(mappedRow.FECHA_SERVICIO_DESDE) ?? undefined,
    FECHA_SERVICIO_HASTA:
      parseLegacyIssueDate(mappedRow.FECHA_SERVICIO_HASTA) ?? undefined,
    FECHA_VTO_PAGO: parseLegacyIssueDate(mappedRow.FECHA_VTO_PAGO) ?? undefined,
  };
}

const LEGACY_DATE_FORMAT = 'dd/MM/yyyy';

function toDateTime(displayDate: string | undefined): DateTime | undefined {
  if (!displayDate) return undefined;
  const parsed = DateTime.fromFormat(displayDate, LEGACY_DATE_FORMAT);
  return parsed.isValid ? parsed : undefined;
}

function collectRowWarnings(
  mappedRow: Record<string, unknown>,
  rowNumber: number,
  warnings: LegacyInvoiceParseWarning[],
): void {
  const push = (message: string) => warnings.push({ rowNumber, message });
  const rawValue = (key: string) => String(mappedRow[key] ?? '').trim();

  const tipoDoc = rawValue('TIPO_DOC').toUpperCase();
  // Cleaned like the schema's NUMERO transform, so placeholder cells made of
  // separators ('-', '.') are treated as empty here too.
  const documento = cleanDocumentNumber(rawValue('DOCUMENTO'));
  const isUnidentifiedRow = !documento && !IDENTIFIED_DOC_TYPES.has(tipoDoc);
  if (isUnidentifiedRow) {
    push(
      'Receptor sin identificar: se emite como Consumidor Final (DocTipo 99, DocNro 0, condición IVA 5). ' +
      'ARCA lo acepta mientras el total no supere el tope vigente que exige identificar al receptor.',
    );
  } else if (documento && !IDENTIFIED_DOC_TYPES.has(tipoDoc)) {
    // Non-empty here implies tipoDoc is set (empty + documento is a row error).
    push(
      `TIPO_DOC "${rawValue('TIPO_DOC')}" no es CUIT/CUIL/DNI: el portal intentará seleccionar esa opción ` +
      'por etiqueta y, si no existe para este comprobante, la fila falla con error.',
    );
  }

  const rawComprobante = rawValue('COMPROBANTE') || rawValue('FACTURA_TIPO');
  if (rawComprobante && parseLegacyInvoiceType(rawComprobante) === undefined) {
    push(`COMPROBANTE "${rawComprobante}" no reconocido: se emitirá como Factura C (default).`);
  }

  const rawFecha = rawValue('FECHA');
  const fecha = parseLegacyIssueDate(rawFecha);
  if (rawFecha && !fecha) {
    push(`FECHA "${rawFecha}" inválida (formatos aceptados: DD/MM/YYYY o YYYY-MM-DD): se usará la fecha del run.`);
  }

  const rawDesde = rawValue('FECHA_SERVICIO_DESDE');
  const desde = parseLegacyIssueDate(rawDesde);
  if (rawDesde && !desde) {
    push(`PERIODO_DESDE "${rawDesde}" inválida: se usará el período del mes de emisión.`);
  }

  const rawHasta = rawValue('FECHA_SERVICIO_HASTA');
  const hasta = parseLegacyIssueDate(rawHasta);
  if (rawHasta && !hasta) {
    push(`PERIODO_HASTA "${rawHasta}" inválida: se usará el período del mes de emisión.`);
  }

  const rawVto = rawValue('FECHA_VTO_PAGO');
  const vto = parseLegacyIssueDate(rawVto);
  if (rawVto && !vto) {
    push(`FECHA_VTO_PAGO "${rawVto}" inválida: se usará el último día del mes de emisión.`);
  }

  const desdeDate = toDateTime(desde);
  const hastaDate = toDateTime(hasta);
  if (desdeDate && hastaDate && desdeDate > hastaDate) {
    push(
      `Período de servicio invertido (${desde} > ${hasta}): el emisor usará el mes de la fecha de emisión en su lugar.`,
    );
  }

  const vtoDate = toDateTime(vto);
  const fechaDate = toDateTime(fecha);
  if (vtoDate && fechaDate && vtoDate < fechaDate) {
    push(
      `FECHA_VTO_PAGO (${vto}) es anterior a la fecha de emisión (${fecha}): AFIP la rechaza, el emisor usará el último día del mes de emisión.`,
    );
  }

  const rawIvaReceiver = rawValue('IVA_RECEIVER');
  if (rawIvaReceiver) {
    // The effective default must match the mapper: 5 for unidentified rows,
    // 6 for identified ones.
    const defaultIvaCode = isUnidentifiedRow ? 5 : 6;
    const defaultIvaLabel = isUnidentifiedRow
      ? '5 (Consumidor Final)'
      : '6 (Responsable Monotributo)';
    const resolution = resolveIvaReceiverCode(rawIvaReceiver, defaultIvaCode);
    if (resolution.source === 'label') {
      push(
        `CONDICION_IVA_RECEPTOR "${rawIvaReceiver}" interpretada como código ${resolution.code}. ` +
        `Verificá que sea la condición correcta del receptor (si querés el default, dejá la columna vacía o usá ${defaultIvaCode}).`,
      );
    } else if (resolution.source === 'unrecognized') {
      push(
        `CONDICION_IVA_RECEPTOR "${rawIvaReceiver}" no reconocida (códigos válidos: ${VALID_IVA_RECEIVER_CODES.join(', ')} o etiquetas como "Consumidor Final"): se usará ${defaultIvaLabel}.`,
      );
    }
  }

  const rawIvaExento = rawValue('IVA_EXENTO');
  if (rawIvaExento) {
    const parsedExento = parseIvaExentoValue(rawIvaExento);
    if (parsedExento === undefined) {
      push(`IVA_EXENTO "${rawIvaExento}" no reconocido (use true/false, si/no o un porcentaje): se ignora.`);
    } else {
      // Values the pre-2026 transform silently dropped ('sí' with accent,
      // '100%', '10,5') now take effect and change Factura A amounts.
      const legacyParsed = ((value: string) => {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === 'true' || trimmed === 'si' || trimmed === 'yes') return 100;
        if (trimmed === 'false' || trimmed === 'no') return 0;
        return Number(value) || undefined;
      })(rawIvaExento);
      // parsedExento === 0 is amount-identical to "not set", so no warning.
      if (legacyParsed !== parsedExento && parsedExento !== 0) {
        push(
          `IVA_EXENTO "${rawIvaExento}" se interpreta como ${parsedExento}% exento. ` +
          'Versiones anteriores ignoraban este valor (facturaban Factura A con IVA completo): verificá los montos en mapperPreview antes de emitir.',
        );
      }
    }
  }
}

const IGNORED_VALUE_COLUMNS: Array<{ column: string; message: string }> = [
  {
    column: 'HOSPEDAJE',
    message:
      'La columna HOSPEDAJE se acepta pero su valor se IGNORA: el importe facturado sale exclusivamente de TOTAL.',
  },
  {
    column: 'NCOMP',
    message:
      'La columna NRO_COMP/NCOMP se acepta pero su valor se ignora (la numeración la asigna AFIP).',
  },
];

export function parseLegacyInvoiceCsvText(csvText: string): LegacyInvoiceParseResult {
  if (!csvText || csvText.trim().length === 0) {
    throw new Error('Invoice CSV text is empty');
  }

  const parsed = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    cast: false,
    info: true,
  }) as Array<{ record: Record<string, unknown>; info: { lines: number } }>;

  const rawRows = parsed.map(({ record }) => record);
  const rowLines = parsed.map(({ info }) => info.lines);
  const mappedRows = rawRows.map(mapLegacyRowKeys);
  assertRequiredHeaders(mappedRows);

  const presentHeaders = new Set(mappedRows.flatMap((row) => Object.keys(row)));
  const hasReceiverIdentificationHeaders =
    presentHeaders.has('TIPO_DOC') || presentHeaders.has('DOCUMENTO');

  const valid: Columns[] = [];
  const validRowNumbers: number[] = [];
  const invalid: LegacyInvoiceParseError[] = [];
  const warnings: LegacyInvoiceParseWarning[] = [];

  collectHeaderCollisionWarnings(rawRows, warnings);
  collectMissingReceiverHeaderWarnings(mappedRows, warnings);

  for (const { column, message } of IGNORED_VALUE_COLUMNS) {
    if (mappedRows.some((row) => String(row[column] ?? '').trim().length > 0)) {
      warnings.push({ rowNumber: null, message });
    }
  }

  mappedRows.forEach((mappedRow, index) => {
    const rowNumber = rowLines[index] ?? index + 2;

    const rawComprobante =
      String(mappedRow.COMPROBANTE ?? '').trim() ||
      String(mappedRow.FACTURA_TIPO ?? '').trim();
    const unsupportedType = detectUnsupportedComprobante(rawComprobante);
    if (unsupportedType) {
      invalid.push({
        rowNumber,
        error:
          `Tipo de comprobante no soportado: "${rawComprobante}" (${unsupportedType}). ` +
          'Este emisor solo genera Factura A, B o C; notas de crédito/débito y recibos deben emitirse manualmente en el portal AFIP.',
        row: mappedRow,
      });
      return;
    }

    // A number without a document type is ambiguous (CUIT? DNI?): emitting it
    // would either mis-identify the receiver or submit an inconsistent form.
    const rowTipoDoc = String(mappedRow.TIPO_DOC ?? '').trim();
    const rowDocumento = cleanDocumentNumber(String(mappedRow.DOCUMENTO ?? '').trim());
    if (rowDocumento && !rowTipoDoc) {
      invalid.push({
        rowNumber,
        error:
          `La fila tiene DOCUMENTO "${rowDocumento}" pero TIPO_DOC vacío. ` +
          'Indicá el tipo de documento del receptor (CUIT, CUIL o DNI), ' +
          'o vaciá DOCUMENTO para emitir como Consumidor Final sin identificar.',
        row: mappedRow,
      });
      return;
    }

    collectRowWarnings(mappedRow, rowNumber, warnings);

    const schemaInput = toSchemaInput(mappedRow);
    // zod does not catch throws inside transforms (parseAmount on TOTAL), so
    // guard here to keep one bad cell from aborting the whole parse.
    let result: ReturnType<typeof ColumnsSchema.safeParse>;
    try {
      result = ColumnsSchema.safeParse(schemaInput);
    } catch (transformError) {
      invalid.push({
        rowNumber,
        error: transformError instanceof Error ? transformError.message : String(transformError),
        row: mappedRow,
      });
      return;
    }
    if (result.success) {
      valid.push(result.data);
      validRowNumbers.push(rowNumber);
      return;
    }

    invalid.push({
      rowNumber,
      error: result.error.issues.map((issue) => issue.message).join('; '),
      row: mappedRow,
    });
  });

  return { valid, validRowNumbers, invalid, warnings, hasReceiverIdentificationHeaders };
}
