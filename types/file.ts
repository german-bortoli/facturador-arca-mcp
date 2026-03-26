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


export const ColumnsSchema = z.object({
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
  IVA_GRAVADO: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: percentage (default: 100)
  IVA_EXCEMPT: z.string().nullish().transform(val => {
    if (!val) return undefined;
    const trimmed = val.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === 'si' || trimmed === 'yes') return 100;
    if (trimmed === 'false' || trimmed === 'no') return 0;
    return Number(val) || undefined;
  }),
  IVA_PERCENTAGE: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: tax rate (default: 21)
  IVA_RECEIVER: z.string().nullish().transform(val => val?.trim() || undefined), // Optional: numeric code 1-16 or text label (e.g. "IVA Responsable Inscripto")
  FECHA_SERVICIO_DESDE: z.string().nullish().transform(parseOptionalDate), // Optional: Service period start date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_SERVICIO_HASTA: z.string().nullish().transform(parseOptionalDate), // Optional: Service period end date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_VTO_PAGO: z.string().nullish().transform(parseOptionalDate), // Optional: Payment due date (DD/MM/YYYY or YYYY-MM-DD)
}).strict();

/** Column names in schema definition order (for CSV/XLSX output). */
export const COLUMNS_ORDER = Object.keys(
  ColumnsSchema.shape,
) as (keyof z.infer<typeof ColumnsSchema>)[];

export type Columns = z.infer<typeof ColumnsSchema>;
