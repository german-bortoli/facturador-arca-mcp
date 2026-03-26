import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
import { ColumnsSchema, type Columns } from '../../types/file';

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
  IVAEXCEMPT: 'IVA_EXCEMPT',
  IVAEXENTO: 'IVA_EXCEMPT',
  IVAPERCENTAGE: 'IVA_PERCENTAGE',
  PORCENTAJEIVA: 'IVA_PERCENTAGE',
  ALICUOTAIVA: 'IVA_PERCENTAGE',
  CONDICIONIVARECEPTOR: 'IVA_RECEIVER',
  CONDICIONIVA: 'IVA_RECEIVER',
  IVARECEPTOR: 'IVA_RECEIVER',
  IVARECEIVER: 'IVA_RECEIVER',
  FACTURATIPO: 'FACTURA_TIPO',
};

const REQUIRED_LEGACY_HEADERS = ['TOTAL', 'PAGADOR', 'TIPO_DOC', 'DOCUMENTO'] as const;

export interface LegacyInvoiceParseError {
  rowNumber: number;
  error: string;
  row: Record<string, unknown>;
}

export interface LegacyInvoiceParseResult {
  valid: Columns[];
  invalid: LegacyInvoiceParseError[];
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
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    const mappedHeader = LEGACY_HEADER_ALIASES[normalized] ?? normalized;
    mapped[mappedHeader] = value;
  }
  return mapped;
}

function assertRequiredHeaders(rows: Record<string, unknown>[]): void {
  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  const missing = REQUIRED_LEGACY_HEADERS.filter((header) => !headers.has(header));
  if (missing.length > 0) {
    throw new Error(`Legacy CSV is missing required headers: ${missing.join(', ')}`);
  }
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

function parseLegacyIssueDate(rawDate: unknown): string | undefined {
  const normalized = String(rawDate ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized)) {
    return normalized;
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
    IVA_EXCEMPT: String(mappedRow.IVA_EXCEMPT ?? '').trim() || undefined,
    IVA_PERCENTAGE: String(mappedRow.IVA_PERCENTAGE ?? '').trim() || undefined,
    IVA_RECEIVER: String(mappedRow.IVA_RECEIVER ?? '').trim() || undefined,
    FECHA_SERVICIO_DESDE:
      parseLegacyIssueDate(mappedRow.FECHA_SERVICIO_DESDE) ?? undefined,
    FECHA_SERVICIO_HASTA:
      parseLegacyIssueDate(mappedRow.FECHA_SERVICIO_HASTA) ?? undefined,
    FECHA_VTO_PAGO: parseLegacyIssueDate(mappedRow.FECHA_VTO_PAGO) ?? undefined,
  };
}

export function parseLegacyInvoiceCsvText(csvText: string): LegacyInvoiceParseResult {
  if (!csvText || csvText.trim().length === 0) {
    throw new Error('Invoice CSV text is empty');
  }

  const parsed = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    cast: false,
  }) as Record<string, unknown>[];

  const mappedRows = parsed.map(mapLegacyRowKeys);
  assertRequiredHeaders(mappedRows);

  const valid: Columns[] = [];
  const invalid: LegacyInvoiceParseError[] = [];

  mappedRows.forEach((mappedRow, index) => {
    const schemaInput = toSchemaInput(mappedRow);
    const result = ColumnsSchema.safeParse(schemaInput);
    if (result.success) {
      valid.push(result.data);
      return;
    }

    invalid.push({
      rowNumber: index + 2,
      error: result.error.issues.map((issue) => issue.message).join('; '),
      row: mappedRow,
    });
  });

  return { valid, invalid };
}
