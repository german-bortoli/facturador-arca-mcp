import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import type { StoredClient, StoreClientInput, UpdateClientInput } from './types';
import { encryptPassword, decryptPassword } from './crypto';

const DB_FILENAME = 'client_store.db';

let dbInstance: Database.Database | null = null;

function getDbPath(): string {
  return resolve(process.cwd(), DB_FILENAME);
}

function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  dbInstance = new Database(getDbPath());
  dbInstance.pragma('journal_mode = WAL');

  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      issuer_cuit            TEXT PRIMARY KEY,
      afip_username          TEXT NOT NULL,
      afip_password_encrypted TEXT NOT NULL,
      business_name          TEXT NOT NULL,
      points_of_sale_json    TEXT NOT NULL,
      default_point_of_sale  TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    )
  `);

  return dbInstance;
}

function rowToStoredClient(row: Record<string, unknown>): StoredClient {
  return {
    issuerCuit: row.issuer_cuit as string,
    afipUsername: row.afip_username as string,
    afipPasswordEncrypted: row.afip_password_encrypted as string,
    businessName: row.business_name as string,
    pointsOfSale: JSON.parse(row.points_of_sale_json as string) as string[],
    defaultPointOfSale: (row.default_point_of_sale as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function upsertClient(input: StoreClientInput): { stored: StoredClient; updated: boolean } {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT issuer_cuit FROM clients WHERE issuer_cuit = ?')
    .get(input.AFIP_ISSUER_CUIT) as Record<string, unknown> | undefined;

  const encrypted = encryptPassword(input.AFIP_PASSWORD);

  if (existing) {
    db.prepare(
      `UPDATE clients SET
        afip_username = ?,
        afip_password_encrypted = ?,
        business_name = ?,
        points_of_sale_json = ?,
        default_point_of_sale = ?,
        updated_at = ?
      WHERE issuer_cuit = ?`,
    ).run(
      input.AFIP_USERNAME,
      encrypted,
      input.businessName,
      JSON.stringify(input.pointsOfSale),
      input.defaultPointOfSale ?? null,
      now,
      input.AFIP_ISSUER_CUIT,
    );
  } else {
    db.prepare(
      `INSERT INTO clients (
        issuer_cuit, afip_username, afip_password_encrypted,
        business_name, points_of_sale_json, default_point_of_sale,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.AFIP_ISSUER_CUIT,
      input.AFIP_USERNAME,
      encrypted,
      input.businessName,
      JSON.stringify(input.pointsOfSale),
      input.defaultPointOfSale ?? null,
      now,
      now,
    );
  }

  const stored = db
    .prepare('SELECT * FROM clients WHERE issuer_cuit = ?')
    .get(input.AFIP_ISSUER_CUIT) as Record<string, unknown>;

  return { stored: rowToStoredClient(stored), updated: !!existing };
}

export function getClientByIssuerCuit(issuerCuit: string): StoredClient | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM clients WHERE issuer_cuit = ?')
    .get(issuerCuit) as Record<string, unknown> | undefined;

  return row ? rowToStoredClient(row) : null;
}

export function listClients(): StoredClient[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM clients ORDER BY business_name ASC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToStoredClient);
}

export function updateClient(
  issuerCuit: string,
  partial: UpdateClientInput,
): StoredClient {
  const db = getDb();
  const existing = db
    .prepare('SELECT * FROM clients WHERE issuer_cuit = ?')
    .get(issuerCuit) as Record<string, unknown> | undefined;

  if (!existing) {
    throw new Error(`Client with issuer CUIT "${issuerCuit}" not found.`);
  }

  const current = rowToStoredClient(existing);
  const now = new Date().toISOString();

  const newUsername = partial.AFIP_USERNAME?.trim() || current.afipUsername;
  const newBusinessName = partial.businessName?.trim() || current.businessName;
  const newPointsOfSale = partial.pointsOfSale ?? current.pointsOfSale;

  let newDefaultPos: string | null = current.defaultPointOfSale;
  if (partial.defaultPointOfSale !== undefined) {
    newDefaultPos = partial.defaultPointOfSale;
  }
  if (newDefaultPos && !newPointsOfSale.includes(newDefaultPos)) {
    throw new Error(
      `defaultPointOfSale "${newDefaultPos}" must be one of pointsOfSale: [${newPointsOfSale.join(', ')}].`,
    );
  }

  const newPasswordEncrypted = partial.AFIP_PASSWORD
    ? encryptPassword(partial.AFIP_PASSWORD)
    : current.afipPasswordEncrypted;

  db.prepare(
    `UPDATE clients SET
      afip_username = ?,
      afip_password_encrypted = ?,
      business_name = ?,
      points_of_sale_json = ?,
      default_point_of_sale = ?,
      updated_at = ?
    WHERE issuer_cuit = ?`,
  ).run(
    newUsername,
    newPasswordEncrypted,
    newBusinessName,
    JSON.stringify(newPointsOfSale),
    newDefaultPos,
    now,
    issuerCuit,
  );

  return rowToStoredClient(
    db.prepare('SELECT * FROM clients WHERE issuer_cuit = ?').get(issuerCuit) as Record<string, unknown>,
  );
}

export function deleteClient(issuerCuit: string): boolean {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM clients WHERE issuer_cuit = ?')
    .run(issuerCuit);
  return result.changes > 0;
}

export function decryptClientPassword(client: StoredClient): string {
  return decryptPassword(client.afipPasswordEncrypted);
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Override the database instance (for testing with in-memory databases).
 */
export function setDbInstanceForTesting(db: Database.Database): void {
  dbInstance = db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      issuer_cuit            TEXT PRIMARY KEY,
      afip_username          TEXT NOT NULL,
      afip_password_encrypted TEXT NOT NULL,
      business_name          TEXT NOT NULL,
      points_of_sale_json    TEXT NOT NULL,
      default_point_of_sale  TEXT,
      created_at             TEXT NOT NULL,
      updated_at             TEXT NOT NULL
    )
  `);
}
