/**
 * Document type mappings for AFIP
 */
export const DOCUMENT_TYPES = {
  CUIT: 80,
  CUIL: 86,
  DNI: 96,
  CONSUMIDOR_FINAL: 99,
} as const;

/**
 * Invoice type codes for AFIP
 */
export const INVOICE_TYPES = {
  FACTURA_A: 1,
  FACTURA_B: 6,
  FACTURA_C: 11,
} as const;

/**
 * IVA Receiver condition codes
 */
export const IVA_RECEIVER_CONDITIONS = {
  IVA_RESPONSABLE_INSCRIPTO: 1,
  IVA_SUJETO_EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  RESPONSABLE_MONOTRIBUTO: 6,
  SUJETO_NO_CATEGORIZADO: 7,
  PROVEEDOR_EXTERIOR: 8,
  CLIENTE_EXTERIOR: 9,
  IVA_LIBERADO_LEY_19640: 10,
  MONOTRIBUTISTA_SOCIAL: 13,
  IVA_NO_ALCANZADO: 15,
  MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO: 16,
} as const;

export const CONCEPTO_TYPES = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_SERVICIOS: 3,
} as const

/**
 * AFIP invoice request data structure
 */
export interface AfipInvoiceData {
  CantReg: number;
  CbteTipo: number;
  DocTipo: number;
  DocNro: number;
  CbteFch: number;
  FchServDesde?: number | null;
  FchServHasta?: number | null;
  FchVtoPago?: number | null;
  ImpTotal: number;
  ImpTotConc: number;
  ImpNeto: number;
  ImpOpEx: number;
  ImpIVA: number;
  ImpTrib: number;
  MonId: string;
  MonCotiz: number;
  CondicionIVAReceptorId: number;
  Iva?: Array<{
    Id: number;
    BaseImp: number;
    Importe: number;
  }>;
}

/**
 * Invoice creation response from AFIP
 */
export interface InvoiceCreationResponse {
  CAE: string;
  CAEFchVto: string;
  voucher_number?: number;
}

/**
 * Invoice generation result
 */
export interface InvoiceGenerationResult {
  success: boolean;
  invoiceNumber?: number;
  cae?: string;
  caeExpiration?: string;
  error?: string;
  customerName: string;
}

/**
 * Configuration options for invoice processing
 */
export interface InvoiceProcessingConfig {
  puntoDeVenta: number;
  invoiceType?: 'A' | 'B' | 'C';
  outputDirectory: string;
  sheetName?: string;
}
