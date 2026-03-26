import type { Columns } from '../types/file';
import type { AfipInvoiceData } from '../types/invoice';
import {
  DOCUMENT_TYPES,
  INVOICE_TYPES,
  IVA_RECEIVER_CONDITIONS,
} from '../types/invoice';
import {
  cleanDocumentNumber,
  parseAmount,
  normalizeDocumentType,
  parsePercentage,
  parseInvoiceType,
  parseIvaReceiverCode,
  parseDateToAfip,
} from '../utils/data-cleaner';
import {
  getCurrentDateAfip,
  formatDateFromAfip,
} from '../utils/date-formatter';

/**
 * Map Excel row data to AFIP invoice format
 * @param row - Excel row data
 * @param puntoDeVenta - Point of sale number
 * @param invoiceNumber - Invoice number
 * @param defaultInvoiceType - Default invoice type if not in Excel
 * @returns Object with AFIP invoice data and document type label
 */
export function mapInvoiceData<T extends Columns>(
  row: T,
  opts: {
    defaultInvoiceType?: 'A' | 'B' | 'C';
    date?: Date;
  } = {
      defaultInvoiceType: 'C',
    }
): {
  invoiceData: AfipInvoiceData;
  documentTypeLabel: string;
  customerName: string;
  customerDocumentNumber: string;
  isConsumidorFinal: boolean;
  ivaConditionLabel: string;
} {
  // Parse document type first to determine if customer info is required
  const documentTypeStr = normalizeDocumentType(row.TIPO_DOCUMENTO || '');
  const isConsumidorFinal = documentTypeStr !== 'CUIT' &&
    documentTypeStr !== 'CUIL' &&
    documentTypeStr !== 'DNI';

  // Parse customer information (optional for CONSUMIDOR FINAL)
  const customerName = row.NOMBRE?.trim() || '';
  const documentNumber = row.NUMERO ? cleanDocumentNumber(row.NUMERO) : '';

  // Validate: For non-CONSUMIDOR_FINAL, name and number are required
  if (!isConsumidorFinal) {
    if (!customerName) {
      throw new Error('NOMBRE is required for non-CONSUMIDOR FINAL invoices');
    }
    if (!documentNumber) {
      throw new Error('NUMERO is required for non-CONSUMIDOR FINAL invoices');
    }
  }

  const total = parseAmount(row.TOTAL);
  if (total <= 0) {
    throw new Error('TOTAL must be greater than 0');
  }

  // Map document type to AFIP code
  let docTipo: number;
  let documentTypeLabel: string;
  switch (documentTypeStr) {
    case 'CUIT':
      docTipo = DOCUMENT_TYPES.CUIT;
      documentTypeLabel = 'CUIT';
      break;
    case 'CUIL':
      docTipo = DOCUMENT_TYPES.CUIL;
      documentTypeLabel = 'CUIL';
      break;
    case 'DNI':
      docTipo = DOCUMENT_TYPES.DNI;
      documentTypeLabel = 'DNI';
      break;
    default:
      docTipo = DOCUMENT_TYPES.CONSUMIDOR_FINAL;
      documentTypeLabel = 'CONSUMIDOR FINAL';
  }

  // Parse optional columns with defaults
  const invoiceType = parseInvoiceType(
    row.FACTURA_TIPO ?? 'C'
  );
  const ivaExempt = parsePercentage(row.IVA_EXCEMPT, 0);
  const ivaGravado = parsePercentage(row.IVA_GRAVADO, ivaExempt > 0 ? (100 - ivaExempt) : 100);
  const ivaPercentage = parsePercentage(row.IVA_PERCENTAGE, ivaExempt >= 100 ? 0 : 21);

  const ivaReceiver = parseIvaReceiverCode(
    row.IVA_RECEIVER,
    IVA_RECEIVER_CONDITIONS.RESPONSABLE_MONOTRIBUTO
  );

  // Map invoice type to AFIP code
  let cbteTipo: number;
  switch (invoiceType) {
    case 'A':
      cbteTipo = INVOICE_TYPES.FACTURA_A;
      break;
    case 'B':
      cbteTipo = INVOICE_TYPES.FACTURA_B;
      break;
    case 'C':
      cbteTipo = INVOICE_TYPES.FACTURA_C;
      break;
    default:
      cbteTipo = INVOICE_TYPES.FACTURA_C;
  }

  // Calculate invoice amounts based on invoice type
  let impNeto: number;
  let impIVA: number;
  let impOpEx: number;
  let impTotal: number;
  let ivaArray: Array<{ Id: number; BaseImp: number; Importe: number }> | undefined;


  // Parse IVA data
  if (invoiceType === 'C') {
    // Factura C: Exempt from IVA
    impNeto = total;
    impIVA = 0;
    impOpEx = 0;
    impTotal = total;
    ivaArray = undefined;
  } else {
    // Factura A or B: Calculate IVA
    impNeto = total * (ivaGravado / 100);
    impIVA = impNeto * (ivaPercentage / 100);
    impOpEx = total * (ivaExempt / 100);
    impTotal = impNeto + impIVA + impOpEx;

    // Generate IVA alícuotas array if IVA > 0
    if (impIVA > 0) {
      // Map IVA percentage to AFIP IVA type ID
      // Common mappings: 21% = 5, 10.5% = 4, 27% = 6, 0% = 3
      let ivaId = 5; // Default to 21%
      if (ivaPercentage === 10.5) {
        ivaId = 4;
      } else if (ivaPercentage === 27) {
        ivaId = 6;
      } else if (ivaPercentage === 0) {
        ivaId = 3;
      }

      ivaArray = [
        {
          Id: ivaId,
          BaseImp: impNeto,
          Importe: impIVA,
        },
      ];
    }
  }




  // Get current date in AFIP format
  const fecha = getCurrentDateAfip(opts?.date);

  // Parse optional service period and payment due dates
  const fchServDesde = row.FECHA_SERVICIO_DESDE ? parseDateToAfip(row.FECHA_SERVICIO_DESDE) : null;
  const fchServHasta = row.FECHA_SERVICIO_HASTA ? parseDateToAfip(row.FECHA_SERVICIO_HASTA) : null;
  const fchVtoPago = row.FECHA_VTO_PAGO ? parseDateToAfip(row.FECHA_VTO_PAGO) : null;


  // Build invoice data
  const invoiceData: AfipInvoiceData = {
    CantReg: 1,
    CbteTipo: cbteTipo,
    DocTipo: docTipo,
    DocNro: documentNumber ? parseInt(documentNumber, 10) : 0,
    CbteFch: fecha,
    FchServDesde: fchServDesde ?? null,
    FchServHasta: fchServHasta ?? null,
    FchVtoPago: fchVtoPago ?? null,
    ImpTotal: Math.round(impTotal * 100) / 100, // Round to 2 decimals
    ImpTotConc: 0,
    ImpNeto: Math.round(impNeto * 100) / 100,
    ImpOpEx: Math.round(impOpEx * 100) / 100,
    ImpIVA: Math.round(impIVA * 100) / 100,
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: ivaReceiver,
  };

  // Add IVA array if present
  if (ivaArray) {
    invoiceData.Iva = ivaArray;
  }

  // Map IVA receiver condition code to label
  const ivaConditionLabels: Record<number, string> = {
    [IVA_RECEIVER_CONDITIONS.IVA_RESPONSABLE_INSCRIPTO]: 'Responsable inscripto',
    [IVA_RECEIVER_CONDITIONS.IVA_SUJETO_EXENTO]: 'Sujeto exento',
    [IVA_RECEIVER_CONDITIONS.CONSUMIDOR_FINAL]: 'Consumidor final',
    [IVA_RECEIVER_CONDITIONS.RESPONSABLE_MONOTRIBUTO]: 'Responsable monotributo',
    [IVA_RECEIVER_CONDITIONS.SUJETO_NO_CATEGORIZADO]: 'Sujeto no categorizado',
    [IVA_RECEIVER_CONDITIONS.PROVEEDOR_EXTERIOR]: 'Proveedor exterior',
    [IVA_RECEIVER_CONDITIONS.CLIENTE_EXTERIOR]: 'Cliente exterior',
    [IVA_RECEIVER_CONDITIONS.IVA_LIBERADO_LEY_19640]: 'IVA liberado Ley 19640',
    [IVA_RECEIVER_CONDITIONS.MONOTRIBUTISTA_SOCIAL]: 'Monotributista social',
    [IVA_RECEIVER_CONDITIONS.IVA_NO_ALCANZADO]: 'IVA no alcanzado',
    [IVA_RECEIVER_CONDITIONS.MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO]: 'Monotributo trabajador independiente promovido',
  };
  const ivaConditionLabel = ivaConditionLabels[ivaReceiver] || 'Consumidor final';

  return {
    invoiceData,
    documentTypeLabel,
    customerName,
    customerDocumentNumber: documentNumber,
    isConsumidorFinal,
    ivaConditionLabel,
  };
}

/**
 * Get invoice dates for template rendering
 * @param invoiceData - AFIP invoice data
 * @param invoiceDate - Invoice date in display format
 * @returns Object with formatted dates for template
 */
export function getInvoiceDates(
  invoiceData: AfipInvoiceData,
  invoiceDate: string
): {
  servicePeriodFrom: string;
  servicePeriodTo: string;
  paymentDueDate: string;
} {

  // Use invoice date as fallback if service dates are not provided
  const servicePeriodFrom = invoiceData.FchServDesde
    ? formatDateFromAfip(invoiceData.FchServDesde)
    : invoiceDate;
  const servicePeriodTo = invoiceData.FchServHasta
    ? formatDateFromAfip(invoiceData.FchServHasta)
    : invoiceDate;
  const paymentDueDate = invoiceData.FchVtoPago
    ? formatDateFromAfip(invoiceData.FchVtoPago)
    : invoiceDate;

  return {
    servicePeriodFrom,
    servicePeriodTo,
    paymentDueDate,
  };
}
