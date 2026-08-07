import { describe, expect, test } from 'vitest';
import { dryRunCsv } from '../mcp/tools/dry-run';

describe('dryRunCsv — mapper preview', () => {
  test('previews exactly what would be sent to AFIP for a monotributo row', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION',
      '08/07/2026,Factura C,Servicio mensual,Transferencia,1500,Cliente Demo,DNI,30111222,"Calle Falsa 123"',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });

    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.warnings).toEqual([]);

    const preview = result.mapperPreview[0]!;
    expect(preview.row).toBe(2); // CSV line number (header = 1)
    expect(preview.invoiceType).toBe('Factura C');
    expect(preview.cbteTipo).toBe(11);
    expect(preview.documentType).toBe('DNI');
    expect(preview.documentNumber).toBe('30111222');
    // DNI receivers mirror the issuer: forced to 5 (Consumidor Final).
    expect(preview.condicionIvaReceptor).toEqual({
      id: 5,
      label: 'Consumidor final',
      explicit: false,
    });
    expect(preview.amounts).toEqual({
      ImpNeto: 1500,
      ImpIVA: 0,
      ImpOpEx: 0,
      ImpTotal: 1500,
    });
    expect(preview.ivaBreakdownApplies).toBe(false);
    expect(preview.emissionDate).toBe('08/07/2026');
    expect(preview.servicePeriod).toEqual({
      from: '01/07/2026',
      to: '31/07/2026',
      paymentDue: '31/07/2026',
    });
    expect(preview.mapperError).toBeUndefined();
  });

  test('surfaces mapper errors per row instead of exploding mid-browser', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION',
      // CUIT receiver with empty name: the mapper requires NOMBRE for non-consumidor-final.
      '08/07/2026,Factura C,Servicio,1000,,CUIT,30999888770,"Calle 1"',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    expect(result.validCount).toBe(1);
    expect(result.mapperPreview[0]!.mapperError).toContain('NOMBRE is required');
  });

  test('preview row numbers stay aligned with CSV lines when invalid rows are interspersed', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION',
      '08/07/2026,Nota de credito,Servicio,500,Cliente Uno,DNI,30111222,"Calle 1"', // line 2: rejected
      '08/07/2026,Factura C,Servicio,1000,Cliente Dos,DNI,30111223,"Calle 2"', // line 3: valid
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    expect(result.invalidCount).toBe(1);
    expect(result.invalidRows[0]!.rowNumber).toBe(2);
    expect(result.mapperPreview).toHaveLength(1);
    expect(result.mapperPreview[0]!.row).toBe(3);
    expect(result.mapperPreview[0]!.name).toBe('Cliente Dos');
  });

  test('DNI with an explicit non-5 condition previews the forced 5 with an override warning', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR',
      '08/07/2026,Factura C,Servicio,1000,Cliente Demo,DNI,30111222,"Calle 1",6',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    const preview = result.mapperPreview[0]!;
    expect(preview.condicionIvaReceptor).toEqual({
      id: 5,
      label: 'Consumidor final',
      explicit: true,
    });
    expect(
      preview.warnings?.some((w) => w.includes('TIPO_DOC=DNI fuerza condición IVA receptor 5')),
    ).toBe(true);
  });

  test('minimal CSV without receiver columns previews Consumidor Final sin identificar', () => {
    const csv = [
      'FECHA,CONCEPTO,TOTAL',
      '08/07/2026,Venta mostrador,25000',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);

    const fileWarnings = result.warnings.filter((w) => w.rowNumber === null);
    expect(
      fileWarnings.some((w) => w.message.includes('PAGADOR, TIPO_DOC, DOCUMENTO')),
    ).toBe(true);
    const rowWarnings = result.warnings.filter((w) => w.rowNumber === 2);
    expect(
      rowWarnings.some((w) => w.message.includes('Receptor sin identificar')),
    ).toBe(true);

    const preview = result.mapperPreview[0]!;
    expect(preview.documentType).toBe('CONSUMIDOR FINAL');
    expect(preview.documentNumber).toBe('');
    expect(preview.condicionIvaReceptor).toEqual({
      id: 5,
      label: 'Consumidor final',
      explicit: false,
    });
    expect(preview.amounts!.ImpTotal).toBe(25000);
    expect(preview.mapperError).toBeUndefined();
  });

  test('unidentified receiver with explicit non-5 condition previews the forced 5 with a warning', () => {
    const csv = [
      'FECHA,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,CONDICION_IVA_RECEPTOR',
      '08/07/2026,Venta mostrador,1000,,,,6',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    const preview = result.mapperPreview[0]!;
    expect(preview.condicionIvaReceptor).toEqual({
      id: 5,
      label: 'Consumidor final',
      explicit: true,
    });
    expect(
      preview.warnings?.some((w) =>
        w.includes('Receptor sin identificar fuerza condición IVA receptor 5'),
      ),
    ).toBe(true);
  });

  test('marks explicitly requested receiver conditions', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR',
      '08/07/2026,Factura A,Servicio,1000,Empresa SA,CUIT,30999888770,"Calle 1",IVA Responsable Inscripto',
    ].join('\n');

    const result = dryRunCsv({ invoiceCsvText: csv });
    const preview = result.mapperPreview[0]!;
    expect(preview.condicionIvaReceptor).toEqual({
      id: 1,
      label: 'Responsable inscripto',
      explicit: true,
    });
    expect(preview.invoiceType).toBe('Factura A');
    expect(preview.ivaBreakdownApplies).toBe(true);
    expect(preview.amounts!.ImpIVA).toBe(210);
    expect(preview.amounts!.ImpTotal).toBe(1210);
  });
});
