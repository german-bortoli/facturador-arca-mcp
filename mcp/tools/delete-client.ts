import { deleteClient as deleteClientFromDb } from '../client-store/sqlite';

export interface DeleteClientToolInput {
  AFIP_ISSUER_CUIT: string;
}

export function deleteClient(input: DeleteClientToolInput) {
  if (!input.AFIP_ISSUER_CUIT?.trim() || input.AFIP_ISSUER_CUIT.trim().length < 11) {
    throw new Error('AFIP_ISSUER_CUIT is required and must be at least 11 characters.');
  }

  const deleted = deleteClientFromDb(input.AFIP_ISSUER_CUIT.trim());
  if (!deleted) {
    throw new Error(`Client with issuer CUIT "${input.AFIP_ISSUER_CUIT.trim()}" not found.`);
  }

  return { ok: true, deleted: true };
}
