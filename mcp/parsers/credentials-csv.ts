import { parse } from 'csv-parse/sync';

const CREDENTIALS_HEADER_ALIASES: Record<string, string> = {
  AFIPUSERNAME: 'AFIP_USERNAME',
  USERNAME: 'AFIP_USERNAME',
  AFIPPASSWORD: 'AFIP_PASSWORD',
  PASSWORD: 'AFIP_PASSWORD',
  AFIPISSUERCUIT: 'AFIP_ISSUER_CUIT',
  ISSUERCUIT: 'AFIP_ISSUER_CUIT',
  CUIT: 'AFIP_ISSUER_CUIT',
  RAZONSOCIAL: 'RAZON_SOCIAL',
  TENANTNAME: 'RAZON_SOCIAL',
};

const REQUIRED_CREDENTIAL_HEADERS = [
  'AFIP_USERNAME',
  'AFIP_PASSWORD',
  'AFIP_ISSUER_CUIT',
  'RAZON_SOCIAL',
] as const;

export interface CredentialsRow {
  AFIP_USERNAME: string;
  AFIP_PASSWORD: string;
  AFIP_ISSUER_CUIT: string;
  RAZON_SOCIAL: string;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .trim();
}

function mapRowHeaders(row: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    const mappedHeader = CREDENTIALS_HEADER_ALIASES[normalized] ?? normalized;
    mapped[mappedHeader] = value;
  }
  return mapped;
}

export function parseCredentialsCsvText(csvText: string): CredentialsRow[] {
  if (!csvText || csvText.trim().length === 0) {
    throw new Error('Credentials CSV text is empty');
  }

  const parsed = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    cast: false,
  }) as Record<string, unknown>[];

  const rows = parsed.map(mapRowHeaders);
  if (rows.length === 0) {
    throw new Error('Credentials CSV has no rows');
  }

  const headers = new Set(rows.flatMap((row) => Object.keys(row)));
  const missingHeaders = REQUIRED_CREDENTIAL_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`Credentials CSV is missing required headers: ${missingHeaders.join(', ')}`);
  }

  return rows.map((row, index) => {
    const normalizedRow: CredentialsRow = {
      AFIP_USERNAME: String(row.AFIP_USERNAME ?? '').trim(),
      AFIP_PASSWORD: String(row.AFIP_PASSWORD ?? '').trim(),
      AFIP_ISSUER_CUIT: String(row.AFIP_ISSUER_CUIT ?? '').trim(),
      RAZON_SOCIAL: String(row.RAZON_SOCIAL ?? '').trim(),
    };

    const missingFields = REQUIRED_CREDENTIAL_HEADERS.filter(
      (field) => normalizedRow[field].length === 0,
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Credentials CSV row ${index + 2} is missing values for: ${missingFields.join(', ')}`,
      );
    }

    return normalizedRow;
  });
}
