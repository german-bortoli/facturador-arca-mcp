export interface CredentialInput {
  AFIP_USERNAME?: string;
  AFIP_PASSWORD?: string;
  AFIP_ISSUER_CUIT?: string;
  RAZON_SOCIAL?: string;
}

export interface EmitInvoicesFromLegacyCsvInput {
  invoiceCsvText: string;
  credentialsCsvText?: string;
  credentials?: CredentialInput;
  allowInteractivePrompt?: boolean;
  preferredIssuerCuit?: string;
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
}

export interface DryRunLegacyCsvInput {
  invoiceCsvText: string;
}

export interface ValidateCredentialsSourceInput {
  credentialsCsvText?: string;
  credentials?: CredentialInput;
  allowInteractivePrompt?: boolean;
  preferredIssuerCuit?: string;
}
