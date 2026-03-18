import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parseCredentialsCsvText, type CredentialsRow } from './parsers/credentials-csv';
import { getClientByIssuerCuit, decryptClientPassword } from './client-store/sqlite';
import type { CredentialInput } from './types';

export interface ResolveCredentialsInput {
  explicit?: CredentialInput;
  credentialsCsvText?: string;
  preferredIssuerCuit?: string;
  allowInteractivePrompt?: boolean;
  /** When set, attempt to load credentials from SQLite by issuer CUIT. */
  issuerCuit?: string;
}

export interface ResolvedCredentials {
  AFIP_USERNAME: string;
  AFIP_PASSWORD: string;
  AFIP_ISSUER_CUIT: string;
  RAZON_SOCIAL: string;
  /** Available POS values from stored client (if loaded from SQLite). */
  storedPointsOfSale?: string[];
  /** Default POS from stored client (if loaded from SQLite). */
  storedDefaultPointOfSale?: string | null;
}

function pickCsvCredentialRow(
  rows: CredentialsRow[],
  preferredIssuerCuit?: string,
): CredentialsRow {
  if (!preferredIssuerCuit) return rows[0]!;
  const matched = rows.find(
    (row) => row.AFIP_ISSUER_CUIT.trim() === preferredIssuerCuit.trim(),
  );
  return matched ?? rows[0]!;
}

function mergeCredentials(
  base: CredentialInput,
  override?: CredentialInput,
): CredentialInput {
  return {
    AFIP_USERNAME: override?.AFIP_USERNAME ?? base.AFIP_USERNAME,
    AFIP_PASSWORD: override?.AFIP_PASSWORD ?? base.AFIP_PASSWORD,
    AFIP_ISSUER_CUIT: override?.AFIP_ISSUER_CUIT ?? base.AFIP_ISSUER_CUIT,
    RAZON_SOCIAL: override?.RAZON_SOCIAL ?? base.RAZON_SOCIAL,
  };
}

async function promptForMissingCredentials(
  partial: CredentialInput,
): Promise<CredentialInput> {
  const rl = createInterface({ input, output });
  try {
    return {
      AFIP_USERNAME:
        partial.AFIP_USERNAME ??
        (await rl.question('AFIP username: ')).trim(),
      AFIP_PASSWORD:
        partial.AFIP_PASSWORD ??
        (await rl.question('AFIP password: ')).trim(),
      AFIP_ISSUER_CUIT:
        partial.AFIP_ISSUER_CUIT ??
        (await rl.question('AFIP issuer CUIT: ')).trim(),
      RAZON_SOCIAL:
        partial.RAZON_SOCIAL ??
        (await rl.question('Razon social (tenant): ')).trim(),
    };
  } finally {
    rl.close();
  }
}

export async function resolveCredentials(
  inputConfig: ResolveCredentialsInput,
): Promise<ResolvedCredentials> {
  const explicit = inputConfig.explicit ?? {};
  let csvCredentials: CredentialInput = {};
  let storedPointsOfSale: string[] | undefined;
  let storedDefaultPointOfSale: string | null | undefined;

  if (inputConfig.credentialsCsvText?.trim()) {
    const rows = parseCredentialsCsvText(inputConfig.credentialsCsvText);
    const picked = pickCsvCredentialRow(rows, inputConfig.preferredIssuerCuit);
    csvCredentials = {
      AFIP_USERNAME: picked.AFIP_USERNAME,
      AFIP_PASSWORD: picked.AFIP_PASSWORD,
      AFIP_ISSUER_CUIT: picked.AFIP_ISSUER_CUIT,
      RAZON_SOCIAL: picked.RAZON_SOCIAL,
    };
  }

  let merged = mergeCredentials(csvCredentials, explicit);

  // Priority 3: fill remaining gaps from SQLite-stored client credentials.
  const lookupCuit = inputConfig.issuerCuit ?? merged.AFIP_ISSUER_CUIT;
  if (lookupCuit?.trim()) {
    const storedClient = getClientByIssuerCuit(lookupCuit.trim());
    if (storedClient) {
      const storedCreds: CredentialInput = {
        AFIP_USERNAME: storedClient.afipUsername,
        AFIP_PASSWORD: decryptClientPassword(storedClient),
        AFIP_ISSUER_CUIT: storedClient.issuerCuit,
        RAZON_SOCIAL: storedClient.businessName,
      };
      merged = mergeCredentials(storedCreds, merged);
      storedPointsOfSale = storedClient.pointsOfSale;
      storedDefaultPointOfSale = storedClient.defaultPointOfSale;
    }
  }

  const missing = Object.entries(merged)
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([key]) => key);

  if (missing.length > 0 && inputConfig.allowInteractivePrompt) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        `Missing credential values: ${missing.join(
          ', ',
        )}. Interactive prompt is not available in non-interactive mode.`,
      );
    }
    merged = await promptForMissingCredentials(merged);
  }

  const stillMissing = Object.entries(merged)
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([key]) => key);

  if (stillMissing.length > 0) {
    throw new Error(
      `Missing credential values: ${stillMissing.join(
        ', ',
      )}. Provide explicit values, credentials CSV, stored client, or enable interactive prompt.`,
    );
  }

  return {
    AFIP_USERNAME: merged.AFIP_USERNAME!,
    AFIP_PASSWORD: merged.AFIP_PASSWORD!,
    AFIP_ISSUER_CUIT: merged.AFIP_ISSUER_CUIT!,
    RAZON_SOCIAL: merged.RAZON_SOCIAL!,
    storedPointsOfSale,
    storedDefaultPointOfSale,
  };
}
