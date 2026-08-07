import { describe, expect, test } from 'vitest';
import { ColumnsSchema, type Columns } from '../types/file';
import { mapInvoiceData } from '../mappers/invoice-mapper';
import { parseInvoiceType } from '../utils/data-cleaner';

/** Builds a Columns row through the real schema, like both parsers do. */
function buildRow(overrides: Record<string, string | undefined> = {}): Columns {
  return ColumnsSchema.parse({
    NOMBRE: 'Cliente Demo',
    TIPO_DOCUMENTO: 'DNI',
    NUMERO: '30111222',
    CONCEPTO: 'Servicio mensual',
    TOTAL: '1000',
    ...overrides,
  }) as Columns;
}

describe('mapInvoiceData — monotributo (Factura C)', () => {
  test('maps a typical monotributo row with no optional columns', () => {
    const { invoiceData, documentTypeLabel, isConsumidorFinal } = mapInvoiceData(buildRow());

    expect(invoiceData.CbteTipo).toBe(11); // Factura C
    expect(invoiceData.DocTipo).toBe(96); // DNI
    expect(invoiceData.DocNro).toBe(30111222);
    expect(invoiceData.ImpNeto).toBe(1000);
    expect(invoiceData.ImpIVA).toBe(0);
    expect(invoiceData.ImpOpEx).toBe(0);
    expect(invoiceData.ImpTotal).toBe(1000);
    expect(invoiceData.Iva).toBeUndefined();
    expect(invoiceData.CondicionIVAReceptorId).toBe(6); // default Responsable Monotributo
    expect(invoiceData.MonId).toBe('PES');
    expect(documentTypeLabel).toBe('DNI');
    expect(isConsumidorFinal).toBe(false);
  });

  test('Factura C ignores IVA columns for amounts', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ IVA_GRAVADO: '50', IVA_EXENTO: '30', IVA_PERCENTAGE: '10.5' }),
    );

    expect(invoiceData.CbteTipo).toBe(11);
    expect(invoiceData.ImpNeto).toBe(1000);
    expect(invoiceData.ImpIVA).toBe(0);
    expect(invoiceData.ImpOpEx).toBe(0);
    expect(invoiceData.ImpTotal).toBe(1000);
    expect(invoiceData.Iva).toBeUndefined();
  });

  test('empty FACTURA_TIPO cell falls back to Factura C instead of crashing', () => {
    const { invoiceData } = mapInvoiceData(buildRow({ FACTURA_TIPO: '' }));
    expect(invoiceData.CbteTipo).toBe(11);
  });

  test('whitespace-only FACTURA_TIPO cell falls back to Factura C', () => {
    const { invoiceData } = mapInvoiceData(buildRow({ FACTURA_TIPO: '  ' }));
    expect(invoiceData.CbteTipo).toBe(11);
  });
});

describe('mapInvoiceData — Responsable Inscripto (Factura A/B)', () => {
  test('Factura B: TOTAL is the final amount, IVA discriminated inside', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ FACTURA_TIPO: 'B', TIPO_DOCUMENTO: 'DNI' }),
    );

    expect(invoiceData.CbteTipo).toBe(6);
    expect(invoiceData.ImpTotal).toBe(1000);
    expect(invoiceData.ImpNeto).toBe(826.45); // 1000 / 1.21
    expect(invoiceData.ImpIVA).toBe(173.55);
    expect(invoiceData.ImpOpEx).toBe(0);
    expect(invoiceData.Iva).toHaveLength(1);
    expect(invoiceData.Iva![0]!.Id).toBe(5);
    expect(invoiceData.Iva![0]!.BaseImp).toBeCloseTo(826.45, 2);
    expect(invoiceData.Iva![0]!.Importe).toBeCloseTo(173.55, 2);
  });

  test('Factura A defaults: TOTAL is net, 21% IVA added on top', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ FACTURA_TIPO: 'A', TIPO_DOCUMENTO: 'CUIT', NUMERO: '30999888770' }),
    );

    expect(invoiceData.CbteTipo).toBe(1);
    expect(invoiceData.ImpNeto).toBe(1000);
    expect(invoiceData.ImpIVA).toBe(210);
    expect(invoiceData.ImpOpEx).toBe(0);
    expect(invoiceData.ImpTotal).toBe(1210);
    expect(invoiceData.Iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }]);
  });

  test('Factura A with IVA_EXENTO=true: full amount exempt, no IVA', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({
        FACTURA_TIPO: 'A',
        TIPO_DOCUMENTO: 'CUIT',
        NUMERO: '30999888770',
        IVA_EXENTO: 'true',
      }),
    );

    expect(invoiceData.ImpNeto).toBe(0);
    expect(invoiceData.ImpIVA).toBe(0);
    expect(invoiceData.ImpOpEx).toBe(1000);
    expect(invoiceData.ImpTotal).toBe(1000);
    expect(invoiceData.Iva).toBeUndefined();
  });

  test('legacy misspelled IVA_EXCEMPT key still works through the schema', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ FACTURA_TIPO: 'A', TIPO_DOCUMENTO: 'CUIT', IVA_EXCEMPT: 'true' }),
    );
    expect(invoiceData.ImpOpEx).toBe(1000);
    expect(invoiceData.ImpIVA).toBe(0);
  });
});

describe('mapInvoiceData — receiver IVA condition', () => {
  test('text labels resolve to real codes (case/accent-insensitive)', () => {
    expect(
      mapInvoiceData(buildRow({ IVA_RECEIVER: 'Consumidor Final' })).invoiceData
        .CondicionIVAReceptorId,
    ).toBe(5);
    expect(
      mapInvoiceData(buildRow({ IVA_RECEIVER: 'consumidor FINAL' })).invoiceData
        .CondicionIVAReceptorId,
    ).toBe(5);
    expect(
      mapInvoiceData(buildRow({ IVA_RECEIVER: 'IVA Responsable Inscripto' })).invoiceData
        .CondicionIVAReceptorId,
    ).toBe(1);
  });

  test('codes that are not valid receiver codes fall back to the default 6', () => {
    // 2, 3, 11, 12, 14 are inside 1-16 but are NOT valid receiver codes.
    expect(
      mapInvoiceData(buildRow({ IVA_RECEIVER: '2' })).invoiceData.CondicionIVAReceptorId,
    ).toBe(6);
    expect(
      mapInvoiceData(buildRow({ IVA_RECEIVER: '25' })).invoiceData.CondicionIVAReceptorId,
    ).toBe(6);
  });
});

describe('mapInvoiceData — consumidor final sin identificar', () => {
  test('maps a row without any receiver data to DocTipo 99 / DocNro 0 / condition 5', () => {
    const {
      invoiceData,
      documentTypeLabel,
      isConsumidorFinal,
      customerName,
      customerDocumentNumber,
    } = mapInvoiceData(buildRow({ NOMBRE: '', TIPO_DOCUMENTO: '', NUMERO: '' }));

    expect(invoiceData.CbteTipo).toBe(11);
    expect(invoiceData.DocTipo).toBe(99);
    expect(invoiceData.DocNro).toBe(0);
    expect(invoiceData.CondicionIVAReceptorId).toBe(5); // Consumidor Final
    expect(documentTypeLabel).toBe('CONSUMIDOR FINAL');
    expect(isConsumidorFinal).toBe(true);
    expect(customerName).toBe('');
    expect(customerDocumentNumber).toBe('');
  });

  test('TIPO_DOCUMENTO "CONSUMIDOR FINAL" without number also defaults to condition 5', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ NOMBRE: '', TIPO_DOCUMENTO: 'CONSUMIDOR FINAL', NUMERO: '' }),
    );
    expect(invoiceData.DocTipo).toBe(99);
    expect(invoiceData.DocNro).toBe(0);
    expect(invoiceData.CondicionIVAReceptorId).toBe(5);
  });

  test('an explicit IVA_RECEIVER still wins in the mapper (issuer and dry-run force 5 later)', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ NOMBRE: '', TIPO_DOCUMENTO: '', NUMERO: '', IVA_RECEIVER: '1' }),
    );
    expect(invoiceData.CondicionIVAReceptorId).toBe(1);
  });

  test('default stays 6 when a document number is present without TIPO_DOCUMENTO (legacy flow)', () => {
    const { invoiceData } = mapInvoiceData(
      buildRow({ TIPO_DOCUMENTO: '', NUMERO: '20999888776' }),
    );
    expect(invoiceData.DocTipo).toBe(99);
    expect(invoiceData.DocNro).toBe(20999888776);
    expect(invoiceData.CondicionIVAReceptorId).toBe(6);
  });
});

describe('parseInvoiceType — unsupported comprobantes', () => {
  test('rejects credit/debit notes and receipts with a clear message', () => {
    expect(() => parseInvoiceType('Nota de credito')).toThrow(/Unsupported invoice type/);
    expect(() => parseInvoiceType('Recibo C')).toThrow(/Unsupported invoice type/);
  });
});

describe('ColumnsSchema — IVA_EXENTO parsing', () => {
  test.each([
    ['true', 100],
    ['si', 100],
    ['sí', 100], // accented — previously silently treated as "not set"
    ['SI', 100],
    ['no', 0],
    ['false', 0],
    ['0', 0],
    ['50', 50],
    ['10,5', 10.5],
    ['100%', 100],
  ])('parses %s as %s', (raw, expected) => {
    const row = buildRow({ IVA_EXENTO: raw });
    expect(row.IVA_EXENTO).toBe(expected);
  });

  test('unrecognized values are treated as not set', () => {
    expect(buildRow({ IVA_EXENTO: 'n/a' }).IVA_EXENTO).toBeUndefined();
  });
});
