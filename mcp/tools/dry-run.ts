import { parseLegacyInvoiceCsvText } from '../parsers/legacy-invoice-csv';
import type { DryRunCsvInput } from '../types';

export function dryRunCsv(input: DryRunCsvInput) {
  if (!input.invoiceCsvText?.trim()) {
    throw new Error('invoiceCsvText is required');
  }

  const parsed = parseLegacyInvoiceCsvText(input.invoiceCsvText);
  return {
    validCount: parsed.valid.length,
    invalidCount: parsed.invalid.length,
    validPreview: parsed.valid.slice(0, 5),
    invalidRows: parsed.invalid,
  };
}
