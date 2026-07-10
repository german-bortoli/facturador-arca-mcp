import { DateTime } from 'luxon';
import z from 'zod';
import { cleanDocumentNumber, normalizeDocumentType, parseAmount } from '../utils/data-cleaner';

export interface ParseXlsxOptions {
  /**
   * Sheet name to parse. If not provided, the first sheet will be used.
   */
  sheetName?: string;
  /**
   * Whether to use the first row as headers (default: true).
   * When true, returns an array of objects with keys from the first row.
   * When false, returns an array of arrays.
   */
  headerRow?: boolean;
  /**
   * Whether to include empty rows in the output (default: false).
   */
  includeEmptyRows?: boolean;
  /**
   * Custom header mapping. If provided, maps column indices to custom header names.
   */
  headerMapping?: Record<string, string>;
}

export interface ParseCsvOptions {
  /**
   * Whether to use the first row as headers (default: true).
   * When true, returns an array of objects with keys from the first row.
   * When false, returns an array of arrays.
   */
  headerRow?: boolean;
  /**
   * Whether to include empty rows in the output (default: false).
   */
  includeEmptyRows?: boolean;
  /**
   * Custom header mapping. If provided, maps column names to custom header names.
   */
  headerMapping?: Record<string, string>;
}

function parseOptionalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const ddmmyyyy = DateTime.fromFormat(raw, 'dd/MM/yyyy');
  if (ddmmyyyy.isValid) return ddmmyyyy.toJSDate();

  const iso = DateTime.fromFormat(raw, 'yyyy-MM-dd');
  if (iso.isValid) return iso.toJSDate();

  return undefined;
}


/**
 * Parses an IVA_EXENTO cell into an exempt percentage.
 * Accepts booleans ("true"/"si"/"sí"/"yes" -> 100, "false"/"no" -> 0) and
 * numeric percentages ("0", "50", "10,5", "100%"). Accents are ignored.
 * Returns undefined for empty or unrecognized values (treated as "not set").
 */
export function parseIvaExentoValue(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (!normalized) return undefined;
  if (normalized === 'true' || normalized === 'si' || normalized === 'yes') return 100;
  if (normalized === 'false' || normalized === 'no') return 0;
  const numeric = Number(normalized.replace('%', '').replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : undefined;
}

const columnsShape = {
  NOMBRE: z.string(),
  // For CUIT the address is picked up automatically at AFIP
  DOMICILIO: z.string().nullish(),
  TIPO_DOCUMENTO: z.string().transform(val => normalizeDocumentType(val)),
  NUMERO: z.string().transform(val => cleanDocumentNumber(val)),
  CONCEPTO: z.string(),
  COD: z.string().nullish(),
  METODO_PAGO: z.string().nullish(), // Optional: payment method label/value (default in UI flow: "Otros")
  TOTAL: z.string().transform((val) => parseAmount(val)),
  FECHA_EMISION: z.string().nullish(), // Optional: Invoice issue date in DD/MM/YYYY format
  FACTURA_TIPO: z.string().nullish(), // Optional: "A" | "B" | "C" (default: "C")
  IVA_GRAVADO: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: percentage. Only used for Factura A/B (ignored for Factura C)
  IVA_EXENTO: z.string().nullish().transform(parseIvaExentoValue), // Optional: exempt flag/percentage. Only used for Factura A/B (ignored for Factura C)
  IVA_PERCENTAGE: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: tax rate (default: 21). Only used for Factura A/B
  IVA_RECEIVER: z.string().nullish().transform(val => val?.trim() || undefined), // Optional: valid AFIP receiver code or text label (e.g. "IVA Responsable Inscripto")
  FECHA_SERVICIO_DESDE: z.string().nullish().transform(parseOptionalDate), // Optional: Service period start date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_SERVICIO_HASTA: z.string().nullish().transform(parseOptionalDate), // Optional: Service period end date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_VTO_PAGO: z.string().nullish().transform(parseOptionalDate), // Optional: Payment due date (DD/MM/YYYY or YYYY-MM-DD)
};

const BaseColumnsSchema = z.object(columnsShape).strict();

/**
 * Folds the legacy misspelled IVA_EXCEMPT key into IVA_EXENTO so files
 * produced before the rename keep validating (both direct XLSX/CSV headers
 * and re-fed run summaries).
 */
function normalizeLegacyColumnKeys(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'IVA_EXCEMPT' in raw) {
    const { IVA_EXCEMPT, ...rest } = raw as Record<string, unknown>;
    return { ...rest, IVA_EXENTO: (rest as Record<string, unknown>).IVA_EXENTO ?? IVA_EXCEMPT };
  }
  return raw;
}

export const ColumnsSchema = z.preprocess(normalizeLegacyColumnKeys, BaseColumnsSchema);

/** Column names in schema definition order (for CSV/XLSX output). */
export const COLUMNS_ORDER = Object.keys(
  columnsShape,
) as (keyof z.infer<typeof BaseColumnsSchema>)[];

export type Columns = z.infer<typeof BaseColumnsSchema>;
