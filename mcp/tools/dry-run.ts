import { parseLegacyInvoiceCsvText } from '../parsers/legacy-invoice-csv';
import type { DryRunLegacyCsvInput } from '../types';

export function dryRunLegacyCsv(input: DryRunLegacyCsvInput) {
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
