import z from 'zod';
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
 * Normalize document type strings (case-insensitive)
 * @param type - Document type string
 * @returns Normalized document type
 * @example
 * normalizeDocumentType("cuit") // "CUIT"
 * normalizeDocumentType("DNI") // "DNI"
 */
export function normalizeDocumentType(type: string): string {
  return type.toUpperCase().trim();
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
 * Validate and parse invoice type
 * @param type - Invoice type string
 * @param defaultValue - Default value if invalid
 * @returns Validated invoice type ("A", "B", or "C")
 * @example
 * parseInvoiceType("A", "C") // "A"
 * parseInvoiceType("invalid", "C") // "C"
 */
export function parseInvoiceType(
  type: string
): 'A' | 'B' | 'C' {
  return z.enum(['A', 'B', 'C']).parse(type.toUpperCase().trim());
}

/**
 * Parse IVA receiver condition code with validation
 * @param code - IVA receiver code (string or number)
 * @param defaultValue - Default value if invalid
 * @returns Validated code (1-16)
 * @example
 * parseIvaReceiverCode("6", 6) // 6
 * parseIvaReceiverCode("25", 6) // 6 (invalid, returns default)
 */
export function parseIvaReceiverCode(
  code: string | number | undefined,
  defaultValue: number
): number {
  if (code === undefined || code === null || code === '') {
    return defaultValue;
  }

  const parsed = typeof code === 'number' ? code : parseInt(String(code), 10);

  if (isNaN(parsed) || parsed < 1 || parsed > 16) {
    return defaultValue;
  }

  return parsed;
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
  if (!dateStr || typeof dateStr !== 'string' || dateStr.trim() === '') {
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
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return formatDateToAfip(date);
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
