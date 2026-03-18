import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDbInstanceForTesting, closeDb, upsertClient, getClientByIssuerCuit, decryptClientPassword, listClients as listClientsDb, updateClient as updateClientDb, deleteClient as deleteClientDb } from '../mcp/client-store/sqlite';
import { encryptPassword, decryptPassword } from '../mcp/client-store/crypto';
import { storeClient } from '../mcp/tools/store-client';
import { listClients } from '../mcp/tools/list-clients';
import { updateClient } from '../mcp/tools/update-client';
import { deleteClient } from '../mcp/tools/delete-client';
import { resolveCredentials } from '../mcp/credentials-resolver';

const TEST_SECRET = 'test-secret-key-for-unit-tests';

beforeEach(() => {
  process.env.CLIENT_STORE_SECRET_KEY = TEST_SECRET;
  const db = new Database(':memory:');
  setDbInstanceForTesting(db);
});

afterEach(() => {
  closeDb();
  delete process.env.CLIENT_STORE_SECRET_KEY;
});

describe('crypto', () => {
  test('encrypt and decrypt round-trips', () => {
    const original = 'my-secret-password-123!';
    const encrypted = encryptPassword(original);
    expect(encrypted).not.toBe(original);
    expect(decryptPassword(encrypted)).toBe(original);
  });

  test('different encryptions of same value produce different ciphertexts', () => {
    const original = 'same-password';
    const a = encryptPassword(original);
    const b = encryptPassword(original);
    expect(a).not.toBe(b);
    expect(decryptPassword(a)).toBe(original);
    expect(decryptPassword(b)).toBe(original);
  });

  test('throws when CLIENT_STORE_SECRET_KEY is missing', () => {
    delete process.env.CLIENT_STORE_SECRET_KEY;
    expect(() => encryptPassword('test')).toThrow('CLIENT_STORE_SECRET_KEY');
  });
});

describe('sqlite client store', () => {
  test('upsert inserts new client', () => {
    const { stored, updated } = upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'demo-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Demo SA',
      pointsOfSale: ['1', '2', '3'],
      defaultPointOfSale: '2',
    });

    expect(updated).toBe(false);
    expect(stored.issuerCuit).toBe('20999888776');
    expect(stored.businessName).toBe('Demo SA');
    expect(stored.pointsOfSale).toEqual(['1', '2', '3']);
    expect(stored.defaultPointOfSale).toBe('2');
    expect(decryptClientPassword(stored)).toBe('demo-pass');
  });

  test('upsert updates existing client', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'old-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Old Name',
      pointsOfSale: ['1'],
    });

    const { stored, updated } = upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'new-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'New Name SA',
      pointsOfSale: ['1', '5'],
      defaultPointOfSale: '5',
    });

    expect(updated).toBe(true);
    expect(stored.businessName).toBe('New Name SA');
    expect(stored.pointsOfSale).toEqual(['1', '5']);
    expect(decryptClientPassword(stored)).toBe('new-pass');
  });

  test('getClientByIssuerCuit returns null for non-existent', () => {
    expect(getClientByIssuerCuit('99999999999')).toBeNull();
  });

  test('getClientByIssuerCuit retrieves stored client', () => {
    upsertClient({
      AFIP_USERNAME: '20111222333',
      AFIP_PASSWORD: 'pass-123',
      AFIP_ISSUER_CUIT: '20111222333',
      businessName: 'Test SRL',
      pointsOfSale: ['4'],
    });

    const client = getClientByIssuerCuit('20111222333');
    expect(client).not.toBeNull();
    expect(client!.afipUsername).toBe('20111222333');
    expect(client!.businessName).toBe('Test SRL');
  });
});

describe('store_client MCP tool', () => {
  test('stores a client and returns masked summary', () => {
    const result = storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'my-password',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Demo SA',
      pointsOfSale: ['1', '3'],
    });

    expect(result.ok).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.businessName).toBe('Demo SA');
    expect(result.pointsOfSaleCount).toBe(2);
    expect(result.pointsOfSale).toEqual(['1', '3']);
    expect(result.defaultPointOfSale).toBe('1');
    expect(result.issuerCuit).toBe('20999888776');
  });

  test('rejects empty AFIP_USERNAME', () => {
    expect(() =>
      storeClient({
        AFIP_USERNAME: '',
        AFIP_PASSWORD: 'pass',
        AFIP_ISSUER_CUIT: '20999888776',
        businessName: 'Demo SA',
        pointsOfSale: ['1'],
      }),
    ).toThrow('AFIP_USERNAME is required');
  });

  test('rejects short AFIP_ISSUER_CUIT', () => {
    expect(() =>
      storeClient({
        AFIP_USERNAME: '20999888776',
        AFIP_PASSWORD: 'pass',
        AFIP_ISSUER_CUIT: '12345',
        businessName: 'Demo SA',
        pointsOfSale: ['1'],
      }),
    ).toThrow('at least 11 characters');
  });

  test('rejects empty pointsOfSale', () => {
    expect(() =>
      storeClient({
        AFIP_USERNAME: '20999888776',
        AFIP_PASSWORD: 'pass',
        AFIP_ISSUER_CUIT: '20999888776',
        businessName: 'Demo SA',
        pointsOfSale: [],
      }),
    ).toThrow('non-empty array');
  });

  test('rejects defaultPointOfSale not in pointsOfSale', () => {
    expect(() =>
      storeClient({
        AFIP_USERNAME: '20999888776',
        AFIP_PASSWORD: 'pass',
        AFIP_ISSUER_CUIT: '20999888776',
        businessName: 'Demo SA',
        pointsOfSale: ['1', '2'],
        defaultPointOfSale: '5',
      }),
    ).toThrow('must be one of the provided pointsOfSale');
  });

  test('marks updated=true on second upsert', () => {
    storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Demo SA',
      pointsOfSale: ['1'],
    });

    const result = storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'updated-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Demo SA Updated',
      pointsOfSale: ['1', '2'],
    });

    expect(result.updated).toBe(true);
    expect(result.businessName).toBe('Demo SA Updated');
  });
});

describe('resolveCredentials with SQLite fallback', () => {
  test('loads credentials from SQLite when issuerCuit is provided', async () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'sqlite-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'SQLite Client SA',
      pointsOfSale: ['1', '3'],
      defaultPointOfSale: '3',
    });

    const resolved = await resolveCredentials({
      issuerCuit: '20999888776',
    });

    expect(resolved.AFIP_USERNAME).toBe('20999888776');
    expect(resolved.AFIP_PASSWORD).toBe('sqlite-pass');
    expect(resolved.AFIP_ISSUER_CUIT).toBe('20999888776');
    expect(resolved.RAZON_SOCIAL).toBe('SQLite Client SA');
    expect(resolved.storedPointsOfSale).toEqual(['1', '3']);
    expect(resolved.storedDefaultPointOfSale).toBe('3');
  });

  test('explicit credentials override SQLite values', async () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'sqlite-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'SQLite Client SA',
      pointsOfSale: ['1'],
    });

    const resolved = await resolveCredentials({
      explicit: {
        AFIP_USERNAME: 'override-user',
        AFIP_PASSWORD: 'override-pass',
        AFIP_ISSUER_CUIT: '20999888776',
        RAZON_SOCIAL: 'Override Name',
      },
      issuerCuit: '20999888776',
    });

    expect(resolved.AFIP_USERNAME).toBe('override-user');
    expect(resolved.AFIP_PASSWORD).toBe('override-pass');
    expect(resolved.RAZON_SOCIAL).toBe('Override Name');
  });

  test('throws when issuerCuit has no stored client and no other source', async () => {
    await expect(
      resolveCredentials({ issuerCuit: '99999999999' }),
    ).rejects.toThrow('Missing credential values');
  });

  test('existing explicit+CSV flows still work without issuerCuit', async () => {
    const resolved = await resolveCredentials({
      explicit: {
        AFIP_USERNAME: '20111222333',
        AFIP_PASSWORD: 'explicit-pass',
        AFIP_ISSUER_CUIT: '20111222333',
        RAZON_SOCIAL: 'Explicit SA',
      },
    });

    expect(resolved.AFIP_USERNAME).toBe('20111222333');
    expect(resolved.storedPointsOfSale).toBeUndefined();
  });
});

describe('sqlite listClients', () => {
  test('returns empty array when no clients stored', () => {
    expect(listClientsDb()).toEqual([]);
  });

  test('returns all stored clients sorted by business_name', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass-1',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Zeta SRL',
      pointsOfSale: ['1'],
    });
    upsertClient({
      AFIP_USERNAME: '20111222333',
      AFIP_PASSWORD: 'pass-2',
      AFIP_ISSUER_CUIT: '20111222333',
      businessName: 'Alpha SA',
      pointsOfSale: ['2'],
    });

    const clients = listClientsDb();
    expect(clients).toHaveLength(2);
    expect(clients[0]!.businessName).toBe('Alpha SA');
    expect(clients[1]!.businessName).toBe('Zeta SRL');
  });
});

describe('sqlite updateClient', () => {
  test('partial update changes only provided fields', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'original-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Original Name',
      pointsOfSale: ['1', '2'],
      defaultPointOfSale: '1',
    });

    const updated = updateClientDb('20999888776', { businessName: 'Updated Name' });
    expect(updated.businessName).toBe('Updated Name');
    expect(updated.afipUsername).toBe('20999888776');
    expect(updated.pointsOfSale).toEqual(['1', '2']);
    expect(decryptClientPassword(updated)).toBe('original-pass');
  });

  test('re-encrypts password when AFIP_PASSWORD is provided', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'old-pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Test SA',
      pointsOfSale: ['1'],
    });

    const updated = updateClientDb('20999888776', { AFIP_PASSWORD: 'new-pass' });
    expect(decryptClientPassword(updated)).toBe('new-pass');
  });

  test('throws when client does not exist', () => {
    expect(() => updateClientDb('99999999999', { businessName: 'X' })).toThrow('not found');
  });

  test('rejects defaultPointOfSale not in updated pointsOfSale', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Test SA',
      pointsOfSale: ['1', '2'],
      defaultPointOfSale: '1',
    });

    expect(() =>
      updateClientDb('20999888776', { pointsOfSale: ['3', '4'] }),
    ).toThrow('must be one of pointsOfSale');
  });

  test('clears defaultPointOfSale when set to null', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Test SA',
      pointsOfSale: ['1'],
      defaultPointOfSale: '1',
    });

    const updated = updateClientDb('20999888776', { defaultPointOfSale: null });
    expect(updated.defaultPointOfSale).toBeNull();
  });
});

describe('sqlite deleteClient', () => {
  test('deletes existing client', () => {
    upsertClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'To Delete SA',
      pointsOfSale: ['1'],
    });

    expect(deleteClientDb('20999888776')).toBe(true);
    expect(getClientByIssuerCuit('20999888776')).toBeNull();
  });

  test('returns false for non-existent client', () => {
    expect(deleteClientDb('99999999999')).toBe(false);
  });
});

describe('list_clients MCP tool', () => {
  test('returns empty list when no clients', () => {
    const result = listClients();
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.clients).toEqual([]);
  });

  test('returns masked client data', () => {
    storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Demo SA',
      pointsOfSale: ['1'],
    });

    const result = listClients();
    expect(result.count).toBe(1);
    expect(result.clients[0]!.businessName).toBe('Demo SA');
    expect(result.clients[0]!.issuerCuit).toBe('20999888776');
  });
});

describe('update_client MCP tool', () => {
  test('partially updates client and returns masked result', () => {
    storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Old Name',
      pointsOfSale: ['1'],
    });

    const result = updateClient({
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'New Name SA',
      pointsOfSale: ['1', '3'],
    });

    expect(result.ok).toBe(true);
    expect(result.businessName).toBe('New Name SA');
    expect(result.pointsOfSale).toEqual(['1', '3']);
  });

  test('rejects short AFIP_ISSUER_CUIT', () => {
    expect(() =>
      updateClient({ AFIP_ISSUER_CUIT: '123' }),
    ).toThrow('at least 11 characters');
  });

  test('rejects non-existent client', () => {
    expect(() =>
      updateClient({ AFIP_ISSUER_CUIT: '99999999999', businessName: 'X' }),
    ).toThrow('not found');
  });

  test('rejects empty pointsOfSale array', () => {
    storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'Test SA',
      pointsOfSale: ['1'],
    });

    expect(() =>
      updateClient({ AFIP_ISSUER_CUIT: '20999888776', pointsOfSale: [] }),
    ).toThrow('non-empty array');
  });
});

describe('delete_client MCP tool', () => {
  test('deletes existing client', () => {
    storeClient({
      AFIP_USERNAME: '20999888776',
      AFIP_PASSWORD: 'pass',
      AFIP_ISSUER_CUIT: '20999888776',
      businessName: 'To Delete',
      pointsOfSale: ['1'],
    });

    const result = deleteClient({ AFIP_ISSUER_CUIT: '20999888776' });
    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(true);
  });

  test('rejects short AFIP_ISSUER_CUIT', () => {
    expect(() =>
      deleteClient({ AFIP_ISSUER_CUIT: '123' }),
    ).toThrow('at least 11 characters');
  });

  test('throws for non-existent client', () => {
    expect(() =>
      deleteClient({ AFIP_ISSUER_CUIT: '99999999999' }),
    ).toThrow('not found');
  });
});
