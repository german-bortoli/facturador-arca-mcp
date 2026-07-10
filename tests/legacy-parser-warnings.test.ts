import { describe, expect, test } from 'vitest';
import { parseLegacyInvoiceCsvText } from '../mcp/parsers/legacy-invoice-csv';

const BASE_HEADER =
  'FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION';
const BASE_ROW =
  '08/07/2026,Factura C,Servicio mensual,Transferencia,1000,Cliente Demo,DNI,30111222,"Calle Falsa 123"';

describe('legacy parser — schema-canonical header aliases', () => {
  test('recognizes NUMERO, DOMICILIO and FECHA_EMISION headers', () => {
    const csv = [
      'FECHA_EMISION,COMPROBANTE,CONCEPTO,TOTAL,NOMBRE,TIPO_DOC,NUMERO,DOMICILIO',
      '08/07/2026,Factura C,Servicio,1000,Cliente Demo,DNI,30111222,"Calle Falsa 123"',
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.invalid).toHaveLength(0);
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.valid[0]!.FECHA_EMISION).toBe('08/07/2026');
    expect(parsed.valid[0]!.NUMERO).toBe('30111222');
    expect(parsed.valid[0]!.DOMICILIO).toBe('Calle Falsa 123');
  });

  test('recognizes CONDICION VENTA as payment method alias', () => {
    const csv = [
      'FECHA,COMPROBANTE,CONCEPTO,CONDICION VENTA,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION',
      '08/07/2026,Factura C,Servicio,Contado,1000,Cliente Demo,DNI,30111222,"Calle Falsa 123"',
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid[0]!.METODO_PAGO).toBe('Contado');
  });

  test.each([
    ['canonical first', 'DOCUMENTO,NUMERO', '30111222339,00001-00000099'],
    ['alias first', 'NUMERO,DOCUMENTO', '00001-00000099,30111222339'],
  ])(
    'canonical DOCUMENTO wins over NUMERO regardless of column order (%s)',
    (_label, headers, values) => {
      const csv = [
        `FECHA,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,${headers},DIRECCION`,
        `08/07/2026,Factura C,Servicio,1000,Cliente Demo,CUIT,${values},"Calle 1"`,
      ].join('\n');

      const parsed = parseLegacyInvoiceCsvText(csv);
      expect(parsed.valid).toHaveLength(1);
      expect(parsed.valid[0]!.NUMERO).toBe('30111222339');
      const fileLevel = parsed.warnings.filter((w) => w.rowNumber === null);
      expect(fileLevel.some((w) => w.message.includes('NUMERO'))).toBe(true);
    },
  );

  test('canonical DIRECCION and FECHA win over DOMICILIO and FECHA_EMISION', () => {
    const csv = [
      'FECHA,FECHA_EMISION,COMPROBANTE,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,DOMICILIO',
      '01/05/2026,20/05/2026,Factura C,Servicio,1000,Cliente Demo,DNI,30111222,"Calle Real 1","Otra Calle 2"',
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid[0]!.FECHA_EMISION).toBe('01/05/2026');
    expect(parsed.valid[0]!.DOMICILIO).toBe('Calle Real 1');
  });
});

describe('legacy parser — unsupported comprobantes', () => {
  test.each([
    'Nota de Crédito C',
    'Nota de Debito',
    'Recibo C',
    'NC',
    'NOTA CREDITO',
    'N/C',
    'N.C.',
    'N/D',
  ])(
    'rejects "%s" as a row error instead of silently issuing Factura C',
    (comprobante) => {
      const csv = [
        BASE_HEADER,
        `08/07/2026,${comprobante},Servicio,Transferencia,1000,Cliente Demo,DNI,30111222,"Calle Falsa 123"`,
      ].join('\n');

      const parsed = parseLegacyInvoiceCsvText(csv);
      expect(parsed.valid).toHaveLength(0);
      expect(parsed.invalid).toHaveLength(1);
      expect(parsed.invalid[0]!.error).toContain('Tipo de comprobante no soportado');
    },
  );

  test('other rows in the same CSV still parse', () => {
    const csv = [
      BASE_HEADER,
      '08/07/2026,Nota de credito,Servicio,Transferencia,500,Cliente Uno,DNI,30111222,"Calle 1"',
      BASE_ROW,
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.invalid).toHaveLength(1);
  });
});

describe('legacy parser — warnings', () => {
  function warningsFor(header: string, row: string): string[] {
    const parsed = parseLegacyInvoiceCsvText([header, row].join('\n'));
    return parsed.warnings.map((w) => w.message);
  }

  test('typical monotributo row produces no warnings', () => {
    const parsed = parseLegacyInvoiceCsvText([BASE_HEADER, BASE_ROW].join('\n'));
    expect(parsed.warnings).toEqual([]);
  });

  test('text IVA receiver label produces an interpretation warning', () => {
    const messages = warningsFor(
      `${BASE_HEADER},CONDICION_IVA_RECEPTOR`,
      `${BASE_ROW},Consumidor Final`,
    );
    expect(messages.some((m) => m.includes('interpretada como código 5'))).toBe(true);
  });

  test('unrecognized IVA receiver value warns about the default', () => {
    const messages = warningsFor(
      `${BASE_HEADER},CONDICION_IVA_RECEPTOR`,
      `${BASE_ROW},Resp. Inscripto`,
    );
    expect(messages.some((m) => m.includes('no reconocida'))).toBe(true);
  });

  test('numeric IVA receiver code produces no warning', () => {
    const messages = warningsFor(
      `${BASE_HEADER},CONDICION_IVA_RECEPTOR`,
      `${BASE_ROW},5`,
    );
    expect(messages).toEqual([]);
  });

  test('invalid FECHA warns that the run date will be used', () => {
    const messages = warningsFor(
      BASE_HEADER,
      'JUNIO 2026,Factura C,Servicio,Transferencia,1000,Cliente Demo,DNI,30111222,"Calle 1"',
    );
    expect(messages.some((m) => m.includes('FECHA "JUNIO 2026" inválida'))).toBe(true);
  });

  test('impossible calendar dates that match the shape also warn', () => {
    const messages = warningsFor(
      `${BASE_HEADER},PERIODO_DESDE,PERIODO_HASTA`,
      `${BASE_ROW},31/02/2026,30/06/2026`,
    );
    expect(messages.some((m) => m.includes('PERIODO_DESDE "31/02/2026" inválida'))).toBe(true);
  });

  test('payment due before emission date warns about the clamp', () => {
    const messages = warningsFor(
      `${BASE_HEADER},FECHA_VTO_PAGO`,
      `${BASE_ROW},10/02/2026`,
    );
    expect(messages.some((m) => m.includes('anterior a la fecha de emisión'))).toBe(true);
  });

  test('inverted service period warns about the fallback', () => {
    const messages = warningsFor(
      `${BASE_HEADER},PERIODO_DESDE,PERIODO_HASTA`,
      `${BASE_ROW},30/06/2026,01/06/2026`,
    );
    expect(messages.some((m) => m.includes('Período de servicio invertido'))).toBe(true);
  });

  test('an invalid TOTAL marks the row invalid instead of crashing the whole parse', () => {
    const csv = [
      BASE_HEADER,
      '08/07/2026,Factura C,Servicio,Transferencia,abc,Cliente Uno,DNI,30111222,"Calle 1"',
      '08/07/2026,Factura C,Servicio,Transferencia,,Cliente Dos,DNI,30111223,"Calle 2"',
      BASE_ROW,
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.invalid).toHaveLength(2);
    expect(parsed.invalid.map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  test('row numbers count physical CSV lines even with blank lines interspersed', () => {
    const csv = [
      BASE_HEADER,
      '', // blank line 2
      BASE_ROW, // physical line 3
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid).toHaveLength(1);
    expect(parsed.validRowNumbers).toEqual([3]);
  });

  test('non-empty HOSPEDAJE produces a file-level warning', () => {
    const csv = [
      `${BASE_HEADER},HOSPEDAJE`,
      `${BASE_ROW},1000`,
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    const fileLevel = parsed.warnings.filter((w) => w.rowNumber === null);
    expect(fileLevel.some((w) => w.message.includes('HOSPEDAJE'))).toBe(true);
  });

  test('unrecognized IVA_EXENTO value warns', () => {
    const messages = warningsFor(
      `${BASE_HEADER},IVA_EXENTO`,
      `${BASE_ROW},n/a`,
    );
    expect(messages.some((m) => m.includes('IVA_EXENTO'))).toBe(true);
  });

  test('accented "sí" is accepted as exempt, with a reinterpretation warning', () => {
    const csv = [
      `${BASE_HEADER},IVA_EXENTO`,
      `${BASE_ROW},sí`,
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.valid[0]!.IVA_EXENTO).toBe(100);
    // Pre-2026 versions silently ignored 'sí' (billed with full IVA), so the
    // value taking effect now must be surfaced.
    expect(
      parsed.warnings.some((w) => w.message.includes('se interpreta como 100% exento')),
    ).toBe(true);
  });

  test('plain "si" is accepted as exempt without warnings (legacy-compatible value)', () => {
    const csv = [
      `${BASE_HEADER},IVA_EXENTO`,
      `${BASE_ROW},si`,
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.valid[0]!.IVA_EXENTO).toBe(100);
  });
});
