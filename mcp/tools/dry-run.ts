import { parseLegacyInvoiceCsvText } from '../parsers/legacy-invoice-csv';
import { mapInvoiceData } from '../../mappers/invoice-mapper';
import { resolveIvaReceiverCode } from '../../utils/data-cleaner';
import { getInvoicingDate } from './emit-invoices';
import { resolveServicePeriod, type DisplayDate } from '../../utils/service-period';
import {
  DOCUMENT_TYPES,
  INVOICE_TYPES,
  IVA_RECEIVER_CONDITIONS,
} from '../../types/invoice';
import type { DryRunCsvInput } from '../types';

const CBTE_TIPO_LABELS: Record<number, string> = {
  [INVOICE_TYPES.FACTURA_A]: 'Factura A',
  [INVOICE_TYPES.FACTURA_B]: 'Factura B',
  [INVOICE_TYPES.FACTURA_C]: 'Factura C',
};

export interface MapperPreviewRow {
  /** 1-based CSV line (header = 1), matching the rowNumber used in warnings/invalidRows. */
  row: number;
  name: string;
  invoiceType?: string;
  cbteTipo?: number;
  documentType?: string;
  documentNumber?: string;
  condicionIvaReceptor?: { id: number; label: string; explicit: boolean };
  amounts?: { ImpNeto: number; ImpIVA: number; ImpOpEx: number; ImpTotal: number };
  /** Factura C ignores IVA_GRAVADO / IVA_EXENTO / ALICUOTA_IVA for amounts. */
  ivaBreakdownApplies?: boolean;
  emissionDate?: string;
  servicePeriod?: { from: string; to: string; paymentDue: string };
  warnings?: string[];
  /** Set when the row parses but the mapper would reject it during emission. */
  mapperError?: string;
}

/**
 * Parses the CSV and previews, per row, exactly what the mapper would send to
 * AFIP (comprobante type, amounts, receiver condition, effective dates), so
 * problems surface here instead of mid-browser during emission.
 */
export function dryRunCsv(input: DryRunCsvInput) {
  if (!input.invoiceCsvText?.trim()) {
    throw new Error('invoiceCsvText is required');
  }

  const parsed = parseLegacyInvoiceCsvText(input.invoiceCsvText);

  const mapperPreview: MapperPreviewRow[] = parsed.valid.map((row, index) => {
    const previewBase = {
      row: parsed.validRowNumbers[index] ?? index + 2,
      name: row.NOMBRE,
    };
    try {
      const mapped = mapInvoiceData(row);
      const emissionDate = (row.FECHA_EMISION?.trim() ||
        getInvoicingDate(Boolean(input.now))) as DisplayDate;
      const period = resolveServicePeriod(row, emissionDate);

      // Mirror the issuer: DNI receivers and unidentified receivers (DocTipo
      // 99 without document number) are always emitted with condition 5
      // (Consumidor Final), regardless of the CSV value.
      const isDni = mapped.invoiceData.DocTipo === DOCUMENT_TYPES.DNI;
      const isUnidentifiedReceiver =
        mapped.invoiceData.DocTipo === DOCUMENT_TYPES.CONSUMIDOR_FINAL &&
        !mapped.customerDocumentNumber;
      const forcesConsumidorFinal = isDni || isUnidentifiedReceiver;
      const effectiveIvaId = forcesConsumidorFinal
        ? IVA_RECEIVER_CONDITIONS.CONSUMIDOR_FINAL
        : mapped.invoiceData.CondicionIVAReceptorId;
      const ivaResolution = resolveIvaReceiverCode(
        row.IVA_RECEIVER,
        IVA_RECEIVER_CONDITIONS.RESPONSABLE_MONOTRIBUTO,
      );
      const ivaExplicitlyRequested =
        ivaResolution.source === 'numeric' || ivaResolution.source === 'label';
      const rowWarnings = [...period.warnings];
      if (
        forcesConsumidorFinal &&
        ivaExplicitlyRequested &&
        mapped.invoiceData.CondicionIVAReceptorId !== effectiveIvaId
      ) {
        rowWarnings.push(
          (isDni
            ? 'TIPO_DOC=DNI fuerza condición IVA receptor 5 (Consumidor final): '
            : 'Receptor sin identificar fuerza condición IVA receptor 5 (Consumidor final): ') +
          `se ignora el valor ${mapped.invoiceData.CondicionIVAReceptorId} (${mapped.ivaConditionLabel}).`,
        );
      }
      if (
        isUnidentifiedReceiver &&
        mapped.invoiceData.CbteTipo === INVOICE_TYPES.FACTURA_A
      ) {
        rowWarnings.push(
          'Factura A exige receptor identificado (Responsable Inscripto): el portal no ofrece ' +
          'Consumidor Final (5) y la fila fallará en la emisión. Agregá TIPO_DOC y DOCUMENTO.',
        );
      }

      return {
        ...previewBase,
        invoiceType:
          CBTE_TIPO_LABELS[mapped.invoiceData.CbteTipo] ??
          `CbteTipo ${mapped.invoiceData.CbteTipo}`,
        cbteTipo: mapped.invoiceData.CbteTipo,
        documentType: mapped.documentTypeLabel,
        documentNumber: mapped.customerDocumentNumber,
        condicionIvaReceptor: {
          id: effectiveIvaId,
          label: forcesConsumidorFinal ? 'Consumidor final' : mapped.ivaConditionLabel,
          explicit: Boolean(row.IVA_RECEIVER?.trim()),
        },
        amounts: {
          ImpNeto: mapped.invoiceData.ImpNeto,
          ImpIVA: mapped.invoiceData.ImpIVA,
          ImpOpEx: mapped.invoiceData.ImpOpEx,
          ImpTotal: mapped.invoiceData.ImpTotal,
        },
        ivaBreakdownApplies: mapped.invoiceData.CbteTipo !== INVOICE_TYPES.FACTURA_C,
        emissionDate: row.FECHA_EMISION?.trim() || `auto (${emissionDate})`,
        servicePeriod: {
          from: period.serviceFrom,
          to: period.serviceTo,
          paymentDue: period.paymentDue,
        },
        warnings: rowWarnings.length > 0 ? rowWarnings : undefined,
      };
    } catch (error) {
      return {
        ...previewBase,
        mapperError: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return {
    validCount: parsed.valid.length,
    invalidCount: parsed.invalid.length,
    validPreview: parsed.valid.slice(0, 5),
    invalidRows: parsed.invalid,
    warnings: parsed.warnings,
    mapperPreview,
  };
}
