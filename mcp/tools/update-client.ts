import { updateClient as updateClientInDb } from '../client-store/sqlite';
import type { UpdateClientInput } from '../client-store/types';

export interface UpdateClientToolInput {
  AFIP_ISSUER_CUIT: string;
  AFIP_USERNAME?: string;
  AFIP_PASSWORD?: string;
  businessName?: string;
  pointsOfSale?: string[];
  defaultPointOfSale?: string | null;
}

function maskValue(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export function updateClient(input: UpdateClientToolInput) {
  if (!input.AFIP_ISSUER_CUIT?.trim() || input.AFIP_ISSUER_CUIT.trim().length < 11) {
    throw new Error('AFIP_ISSUER_CUIT is required and must be at least 11 characters.');
  }

  if (input.pointsOfSale !== undefined) {
    if (!Array.isArray(input.pointsOfSale) || input.pointsOfSale.length === 0) {
      throw new Error('pointsOfSale must be a non-empty array when provided.');
    }
    const normalized = input.pointsOfSale.map((p) => String(p).trim()).filter(Boolean);
    if (normalized.length === 0) {
      throw new Error('pointsOfSale must contain at least one non-empty value.');
    }
  }

  const partial: UpdateClientInput = {};
  if (input.AFIP_USERNAME !== undefined) partial.AFIP_USERNAME = input.AFIP_USERNAME;
  if (input.AFIP_PASSWORD !== undefined) partial.AFIP_PASSWORD = input.AFIP_PASSWORD;
  if (input.businessName !== undefined) partial.businessName = input.businessName;
  if (input.pointsOfSale !== undefined) {
    partial.pointsOfSale = input.pointsOfSale.map((p) => String(p).trim()).filter(Boolean);
  }
  if (input.defaultPointOfSale !== undefined) partial.defaultPointOfSale = input.defaultPointOfSale;

  const updated = updateClientInDb(input.AFIP_ISSUER_CUIT.trim(), partial);

  return {
    ok: true,
    issuerCuit: updated.issuerCuit,
    businessName: updated.businessName,
    username: maskValue(updated.afipUsername),
    pointsOfSale: updated.pointsOfSale,
    defaultPointOfSale: updated.defaultPointOfSale ?? updated.pointsOfSale[0] ?? null,
    updatedAt: updated.updatedAt,
  };
}
