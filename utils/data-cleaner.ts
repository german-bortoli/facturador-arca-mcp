import { formatDateToAfip } from './date-formatter.js';

/**
 * Utility functions for cleaning and parsing Excel data
 */

/**
 * Remove spaces from document number and format as numeric string
 * @param number - Document number with possible spaces
 * @returns Cleaned document number
 * @example
 * cleanDocumentNumber("27 219 622 878") // "27219622878"
 * cleanDocumentNumber("27.219.622-878") // "27219622878"
 * cleanDocumentNumber("27,219,622,878") // "27219622878"
 * cleanDocumentNumber("27-219-622-878") // "27219622878"
 */
export function cleanDocumentNumber(number: string): string {
  return number.replace(/\s+/g, '').replaceAll('.', '').replaceAll(',', '').replaceAll('-', '');
}

/**
 * Parse amount string to number, handling various formats
 * Handles formats like "63 175,00" or "$329,911"
 * @param amount - Amount string with possible formatting
 * @returns Parsed number
 * @example
 * parseAmount("63 175,00") // 63175.00
 * parseAmount("$329,911") // 329911.00
 */
export function parseAmount(amount: string | number): number {

  if (typeof amount === 'number') {
    if (Number.isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount format or value: ' + amount);
    }
    return amount;
  }

  if (!amount || typeof amount !== 'string') {
    throw new Error('Amount must be a non-empty string');
  }

  // Remove currency symbols
  let cleaned = amount.replace(/[$ARS\s]/g, '');

  // Handle comma as decimal separator (Argentine format)
  // If there's a comma, it's likely the decimal separator
  if (cleaned.includes(',')) {
    // Replace comma with dot for decimal
    cleaned = cleaned.replace(',', '.');
    // Remove any remaining dots (thousands separators)
    cleaned = cleaned.replace(/\.(?=.*\.)/g, '');
  } else if (cleaned.includes('.')) {
    // If there's a dot, check if it's decimal or thousands separator
    const parts = cleaned.split('.');
    if (parts.length === 2 && parts[1]!.length <= 2) {
      // Likely decimal separator
      cleaned = cleaned;
    } else {
      // Likely thousands separator, remove it
      cleaned = cleaned.replace(/\./g, '');
    }
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) {
    throw new Error(`Invalid amount format: ${amount}`);
  }

  return parsed;
}

/**
 * AFIP numeric document-type codes accepted as TIPO_DOC aliases. Users who
 * know the AFIP tables naturally write the code (99 = sin identificar).
 */
const DOCUMENT_TYPE_CODE_ALIASES: Record<string, string> = {
  '80': 'CUIT',
  '86': 'CUIL',
  '96': 'DNI',
  '99': 'CONSUMIDOR FINAL',
};

/**
 * Normalize document type strings (case-insensitive). AFIP numeric codes map
 * to their label so "99" behaves exactly like an empty/consumidor-final type.
 * @param type - Document type string
 * @returns Normalized document type
 * @example
 * normalizeDocumentType("cuit") // "CUIT"
 * normalizeDocumentType("DNI") // "DNI"
 * normalizeDocumentType("80") // "CUIT"
 * normalizeDocumentType("99") // "CONSUMIDOR FINAL"
 */
export function normalizeDocumentType(type: string): string {
  const normalized = type.toUpperCase().trim();
  return DOCUMENT_TYPE_CODE_ALIASES[normalized] ?? normalized;
}

/**
 * Cleans a RECEIVER document number treating "no document" spellings as empty:
 * separators only ('-', '.') and all-zero values ('0', '000', the literal
 * DocNro used by AFIP for an unidentified receiver) normalize to ''.
 * @example
 * normalizeOptionalDocumentNumber("20 999 888 776") // "20999888776"
 * normalizeOptionalDocumentNumber("0") // ""
 * normalizeOptionalDocumentNumber("-") // ""
 */
export function normalizeOptionalDocumentNumber(raw: string): string {
  const cleaned = cleanDocumentNumber(raw.trim());
  return /^0*$/.test(cleaned) ? '' : cleaned;
}

/**
 * Parse percentage value with default fallback
 * @param value - Percentage value (string or number)
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed percentage number
 * @example
 * parsePercentage("100", 100) // 100
 * parsePercentage("21.5", 21) // 21.5
 * parsePercentage(undefined, 100) // 100
 */
export function parsePercentage(
  value: string | number | undefined,
  defaultValue: number
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Validate and parse invoice type. Case-insensitive; leading/trailing
 * whitespace is trimmed.
 * @param type - Invoice type string ("A", "B" or "C" in any case)
 * @returns Validated invoice type ("A", "B", or "C")
 * @throws Error for any other value (including empty string and credit/debit
 *   notes or receipts, which this issuer does not support). Callers wanting an
 *   empty-cell default apply it at the call site (see invoice-mapper.ts:
 *   `row.FACTURA_TIPO?.trim() || 'C'`).
 * @example
 * parseInvoiceType(" a ") // "A"
 * parseInvoiceType("Nota de credito") // throws "Unsupported invoice type..."
 */
export function parseInvoiceType(
  type: string
): 'A' | 'B' | 'C' {
  const normalized = type.toUpperCase().trim();
  if (normalized === 'A' || normalized === 'B' || normalized === 'C') {
    return normalized;
  }
  throw new Error(
    `Unsupported invoice type "${type}". Supported values: A, B, C. ` +
    'Credit notes, debit notes and receipts are not supported by this issuer.',
  );
}

/**
 * Receiver IVA condition codes actually accepted by AFIP (RG 5616).
 * Note: 2, 3, 11, 12 and 14 are NOT valid receiver codes even though they
 * fall inside the 1-16 range.
 */
export const VALID_IVA_RECEIVER_CODES: readonly number[] = [
  1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16,
];

export const IVA_RECEIVER_LABEL_MAP: Record<string, number> = {
  'IVA RESPONSABLE INSCRIPTO': 1,
  'RESPONSABLE INSCRIPTO': 1,
  'IVA SUJETO EXENTO': 4,
  'SUJETO EXENTO': 4,
  'CONSUMIDOR FINAL': 5,
  'RESPONSABLE MONOTRIBUTO': 6,
  'MONOTRIBUTO': 6,
  'SUJETO NO CATEGORIZADO': 7,
  'PROVEEDOR EXTERIOR': 8,
  'CLIENTE EXTERIOR': 9,
  'IVA LIBERADO LEY 19640': 10,
  'MONOTRIBUTISTA SOCIAL': 13,
  'IVA NO ALCANZADO': 15,
  'MONOTRIBUTO TRABAJADOR INDEPENDIENTE PROMOVIDO': 16,
};

export interface IvaReceiverResolution {
  /** Resolved code (falls back to the provided default). */
  code: number;
  /** How the code was resolved: empty input, valid numeric code, mapped text label, or unrecognized value. */
  source: 'empty' | 'numeric' | 'label' | 'unrecognized';
  /** Original input (trimmed) when a non-empty value was provided. */
  raw?: string;
}

/**
 * Resolve an IVA receiver condition value reporting HOW it was resolved,
 * so callers can surface warnings (e.g. a text label being interpreted,
 * or an unrecognized value silently falling back to the default).
 */
export function resolveIvaReceiverCode(
  code: string | number | undefined,
  defaultValue: number,
): IvaReceiverResolution {
  if (code === undefined || code === null || code === '') {
    return { code: defaultValue, source: 'empty' };
  }

  if (typeof code === 'number') {
    return VALID_IVA_RECEIVER_CODES.includes(code)
      ? { code, source: 'numeric', raw: String(code) }
      : { code: defaultValue, source: 'unrecognized', raw: String(code) };
  }

  const trimmed = String(code).trim();
  if (!trimmed) {
    return { code: defaultValue, source: 'empty' };
  }

  const parsed = parseInt(trimmed, 10);
  if (!isNaN(parsed)) {
    return VALID_IVA_RECEIVER_CODES.includes(parsed)
      ? { code: parsed, source: 'numeric', raw: trimmed }
      : { code: defaultValue, source: 'unrecognized', raw: trimmed };
  }

  const normalized = trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const matched = IVA_RECEIVER_LABEL_MAP[normalized];
  if (matched !== undefined) {
    return { code: matched, source: 'label', raw: trimmed };
  }
  return { code: defaultValue, source: 'unrecognized', raw: trimmed };
}

/**
 * Parse IVA receiver condition code with validation.
 * Accepts valid AFIP receiver codes (see VALID_IVA_RECEIVER_CODES) or Spanish
 * text labels (e.g. "IVA Responsable Inscripto").
 * @param code - IVA receiver code (string, number, or text label)
 * @param defaultValue - Default value if invalid
 * @returns Validated receiver code
 * @example
 * parseIvaReceiverCode("6", 6) // 6
 * parseIvaReceiverCode("IVA Responsable Inscripto", 6) // 1
 * parseIvaReceiverCode("25", 6) // 6 (invalid, returns default)
 * parseIvaReceiverCode("2", 6) // 6 (2 is not a valid RECEIVER code)
 */
export function parseIvaReceiverCode(
  code: string | number | undefined,
  defaultValue: number
): number {
  return resolveIvaReceiverCode(code, defaultValue).code;
}

/**
 * Parse date string from Excel format (DD/MM/YYYY or YYYY-MM-DD) to AFIP format
 * @param dateStr - Date string in DD/MM/YYYY or YYYY-MM-DD format
 * @returns Date in AFIP format (yyyymmdd) or null if invalid/empty
 * @example
 * parseDateToAfip("25/10/2023") // 20231025
 * parseDateToAfip("2023-10-25") // 20231025
 */
export function parseDateToAfip(dateStr: string | undefined | Date): number | null {
  if (!dateStr) {
    return null;
  }

  if (dateStr instanceof Date) {
    if (isNaN(dateStr.getTime())) {
      return null;
    }
    const year = dateStr.getUTCFullYear();
    const month = String(dateStr.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateStr.getUTCDate()).padStart(2, '0');
    return Number(`${year}${month}${day}`);
  }

  if (typeof dateStr !== 'string' || dateStr.trim() === '') {
    return null;
  }

  const cleaned = dateStr.trim();

  try {
    // Try DD/MM/YYYY format first (Argentine format)
    if (cleaned.includes('/')) {
      const parts = cleaned.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0]!, 10);
        const month = parseInt(parts[1]!, 10);
        const year = parseInt(parts[2]!, 10);

        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          const date = new Date(year, month - 1, day);
          if (!isNaN(date.getTime())) {
            return formatDateToAfip(date);
          }
        }
      }
    }

    // Try YYYY-MM-DD format (ISO format)
    if (cleaned.includes('-')) {
      const parts = cleaned.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0]!, 10);
        const month = parseInt(parts[1]!, 10);
        const day = parseInt(parts[2]!, 10);
        if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
          return Number(
            `${year.toString().padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`,
          );
        }
      }
    }

    // Try parsing as-is (might be already in correct format)
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return formatDateToAfip(date);
    }
  } catch {
    // If parsing fails, return null
    return null;
  }

  return null;
}


/**
 * Creates a parser to retrieve numbers from a stringified currency value made with Intl class
 * @example const parser = makeCurrencyParser("de-DE", { style: "currency", currency: "EUR" });
 * parser("123.456,79 €") // 123456.79
 */
export function makeCurrencyParser(locale: string, options: Intl.NumberFormatOptions) {
  const nf = new Intl.NumberFormat(locale, options);
  const example = nf.formatToParts(12345.6);

  const group = example.find(p => p.type === "group")?.value || ",";
  const decimal = example.find(p => p.type === "decimal")?.value || ".";
  const currency = example.find(p => p.type === "currency")?.value || "";
  const minusSign = example.find(p => p.type === "minusSign")?.value || "-";
  const plusSign = example.find(p => p.type === "plusSign")?.value || "+";

  // Build character class with special chars properly escaped
  // Sort chars to put hyphen at the end to avoid range issues in character class
  const chars = [decimal, minusSign, plusSign].filter(char => char);

  // Separate hyphen from other chars (hyphen must be at start or end of char class)
  const hyphen = chars.find(c => c === '-');
  const otherChars = chars.filter(c => c !== '-').map(char => escapeRegExp(char)).join('');

  // Put hyphen at the end of the character class (no need to escape when at the end)
  const allowedChars = hyphen ? `${otherChars}-` : otherChars;

  const nonDigits = new RegExp(
    `[^0-9${allowedChars}]`,
    "g"
  );

  return function parseCurrency(str: string): number {
    const s = str
      .replace(new RegExp(escapeRegExp(currency), "g"), "")
      .replace(new RegExp(escapeRegExp(group), "g"), "")
      .replace(nonDigits, "")
      .replace(decimal, ".");

    return Number(s);
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
