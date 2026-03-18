import { upsertClient } from '../client-store/sqlite';
import type { StoreClientInput } from '../client-store/types';

export interface StoreClientToolInput {
  AFIP_USERNAME: string;
  AFIP_PASSWORD: string;
  AFIP_ISSUER_CUIT: string;
  businessName: string;
  pointsOfSale: string[];
  defaultPointOfSale?: string;
}

function maskValue(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export function storeClient(input: StoreClientToolInput) {
  if (!input.AFIP_USERNAME?.trim()) {
    throw new Error('AFIP_USERNAME is required.');
  }
  if (!input.AFIP_PASSWORD?.trim()) {
    throw new Error('AFIP_PASSWORD is required.');
  }
  if (!input.AFIP_ISSUER_CUIT?.trim() || input.AFIP_ISSUER_CUIT.trim().length < 11) {
    throw new Error('AFIP_ISSUER_CUIT is required and must be at least 11 characters.');
  }
  if (!input.businessName?.trim()) {
    throw new Error('businessName is required.');
  }
  if (!Array.isArray(input.pointsOfSale) || input.pointsOfSale.length === 0) {
    throw new Error('pointsOfSale must be a non-empty array of POS identifiers.');
  }

  const normalizedPos = input.pointsOfSale.map((p) => String(p).trim()).filter(Boolean);
  if (normalizedPos.length === 0) {
    throw new Error('pointsOfSale must contain at least one non-empty value.');
  }

  if (input.defaultPointOfSale) {
    const defaultPos = String(input.defaultPointOfSale).trim();
    if (!normalizedPos.includes(defaultPos)) {
      throw new Error(
        `defaultPointOfSale "${defaultPos}" must be one of the provided pointsOfSale: [${normalizedPos.join(', ')}].`,
      );
    }
  }

  const storeInput: StoreClientInput = {
    AFIP_USERNAME: input.AFIP_USERNAME.trim(),
    AFIP_PASSWORD: input.AFIP_PASSWORD,
    AFIP_ISSUER_CUIT: input.AFIP_ISSUER_CUIT.trim(),
    businessName: input.businessName.trim(),
    pointsOfSale: normalizedPos,
    defaultPointOfSale: input.defaultPointOfSale?.trim(),
  };

  const { stored, updated } = upsertClient(storeInput);

  return {
    ok: true,
    issuerCuit: stored.issuerCuit,
    businessName: stored.businessName,
    username: maskValue(stored.afipUsername),
    pointsOfSaleCount: stored.pointsOfSale.length,
    pointsOfSale: stored.pointsOfSale,
    defaultPointOfSale: stored.defaultPointOfSale ?? stored.pointsOfSale[0] ?? null,
    updated,
  };
}
