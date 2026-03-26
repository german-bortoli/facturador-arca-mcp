export interface CredentialInput {
  AFIP_USERNAME?: string;
  AFIP_PASSWORD?: string;
  AFIP_ISSUER_CUIT?: string;
  RAZON_SOCIAL?: string;
}

export interface EmitInvoiceInput {
  invoiceCsvText: string;
  credentialsCsvText?: string;
  credentials?: CredentialInput;
  allowInteractivePrompt?: boolean;
  preferredIssuerCuit?: string;
  /** Load credentials from SQLite by issuer CUIT (no need to pass credentials explicitly). */
  issuerCuit?: string;
  headless?: boolean | string;
  slowMoMs?: number;
  retry?: boolean;
  pointOfSale?: string;
  saveSummaryPath?: string;
  summaryFormat?: 'csv' | 'xlsx';
  summaryFailedOnly?: boolean;
  currency?: string;
  globalConcept?: string;
  addMonthToConcept?: boolean;
  now?: boolean;
  debug?: boolean;
  /**
   * AFIP login URL. Defaults to the Monotributo login.
   * Use "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"
   * for Responsable Inscripto taxpayers who don't use the Monotributo portal.
   */
  loginUrl?: string;
  /**
   * Base URL (without port) of this server, e.g. "http://localhost".
   * When provided, emit_invoice returns a downloadUrl for each generated PDF.
   * Falls back to the INVOICE_SERVER_HOST env var when omitted.
   */
  serverHost?: string;
}

export interface DryRunCsvInput {
  invoiceCsvText: string;
}

// Backward-compatible type aliases for older internal references.
export type EmitInvoicesFromLegacyCsvInput = EmitInvoiceInput;
export type DryRunLegacyCsvInput = DryRunCsvInput;

export interface ValidateCredentialsSourceInput {
  credentialsCsvText?: string;
  credentials?: CredentialInput;
  issuerCuit?: string;
  allowInteractivePrompt?: boolean;
  preferredIssuerCuit?: string;
}

export type { StoreClientToolInput } from './tools/store-client';

