import { listClients as listClientsFromDb } from '../client-store/sqlite';

function maskValue(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars) return '*'.repeat(value.length);
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

export function listClients() {
  const clients = listClientsFromDb();

  return {
    ok: true,
    count: clients.length,
    clients: clients.map((c) => ({
      issuerCuit: c.issuerCuit,
      businessName: c.businessName,
      username: maskValue(c.afipUsername),
      pointsOfSale: c.pointsOfSale,
      defaultPointOfSale: c.defaultPointOfSale ?? c.pointsOfSale[0] ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  };
}
