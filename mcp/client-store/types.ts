export interface StoredClient {
  issuerCuit: string;
  afipUsername: string;
  afipPasswordEncrypted: string;
  businessName: string;
  pointsOfSale: string[];
  defaultPointOfSale: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoreClientInput {
  AFIP_USERNAME: string;
  AFIP_PASSWORD: string;
  AFIP_ISSUER_CUIT: string;
  businessName: string;
  pointsOfSale: string[];
  defaultPointOfSale?: string;
}

export interface UpdateClientInput {
  AFIP_USERNAME?: string;
  AFIP_PASSWORD?: string;
  businessName?: string;
  pointsOfSale?: string[];
  defaultPointOfSale?: string | null;
}
