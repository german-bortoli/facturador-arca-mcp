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


export const ColumnsSchema = z.object({
  NOMBRE: z.string(),
  // For CUIT the address is picked up automatically at AFIP
  DOMICILIO: z.string().nullish(),
  TIPO_DOCUMENTO: z.string().transform(val => normalizeDocumentType(val)),
  NUMERO: z.string().transform(val => cleanDocumentNumber(val)),
  CONCEPTO: z.string(),
  COD: z.string().nullish(),
  TOTAL: z.string().transform((val) => parseAmount(val)),
  FACTURA_TIPO: z.string().nullish(), // Optional: "A" | "B" | "C" (default: "C")
  IVA_GRAVADO: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: percentage (default: 100)
  IVA_EXCEMPT: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: percentage (default: 0)
  IVA_PERCENTAGE: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: tax rate (default: 21)
  IVA_RECEIVER: z.string().nullish().transform(val => val ? Number(val) : undefined), // Optional: condition code 1-16 (default: 6)
  FECHA_SERVICIO_DESDE: z.string().nullish().transform(val => val ? DateTime.fromFormat(val, 'dd/MM/yyyy').toJSDate() : undefined), // Optional: Service period start date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_SERVICIO_HASTA: z.string().nullish().transform(val => val ? DateTime.fromFormat(val, 'dd/MM/yyyy').toJSDate() : undefined), // Optional: Service period end date (DD/MM/YYYY or YYYY-MM-DD)
  FECHA_VTO_PAGO: z.string().nullish().transform(val => val ? DateTime.fromFormat(val, 'dd/MM/yyyy').toJSDate() : undefined), // Optional: Payment due date (DD/MM/YYYY or YYYY-MM-DD)
}).strict()

export type Columns = z.infer<typeof ColumnsSchema>;
