import { describe, expect, test } from 'vitest';
import { parseLegacyInvoiceCsvText } from '../mcp/parsers/legacy-invoice-csv';
import { parseCredentialsCsvText } from '../mcp/parsers/credentials-csv';

describe('legacy invoice CSV parser', () => {
  test('parses legacy rows', () => {
    const csv = [
      'MES,Comprobante,N° Comp,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,METODO_PAGO,TOTAL,PAGADOR,RESIDENTE,Tipo doc,Documento,DIRECCION',
      'ABRIL,Factura C,00001-00000001,12/03/2026,Servicio de programacion de software,,150,,Transferencia bancaria,150,Cliente Demo Uno,servicio,DNI,30111222,"Calle Falsa 123, Ciudad Demo, Provincia Demo"',
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.invalid.length).toBe(0);
    expect(parsed.valid.length).toBe(1);
    expect(parsed.valid[0]!.NOMBRE).toBe('Cliente Demo Uno');
    expect(parsed.valid[0]!.TOTAL).toBe(150);
    expect(parsed.valid[0]!.METODO_PAGO).toBe('Transferencia bancaria');
    expect(parsed.valid[0]!.FECHA_EMISION).toBe('12/03/2026');
    expect(parsed.valid[0]!.FACTURA_TIPO).toBe('C');
  });

  test('accepts FECHA in yyyy-MM-dd and normalizes to dd/MM/yyyy', () => {
    const csv = [
      'MES,Comprobante,N° Comp,FECHA,CONCEPTO,TOTAL,PAGADOR,Tipo doc,Documento,DIRECCION',
      'ABRIL,Factura C,00001-00000001,2026-03-12,Servicio de programacion de software,150,Cliente Demo Uno,DNI,30111222,"Calle Falsa 123, Ciudad Demo, Provincia Demo"',
    ].join('\n');

    const parsed = parseLegacyInvoiceCsvText(csv);
    expect(parsed.invalid.length).toBe(0);
    expect(parsed.valid[0]!.FECHA_EMISION).toBe('12/03/2026');
  });
});

describe('credentials csv parser', () => {
  test('parses credentials CSV', () => {
    const csv = [
      'AFIP_USERNAME,AFIP_PASSWORD,AFIP_ISSUER_CUIT,RAZON_SOCIAL',
      '20999888776,demo-password-123,20999888776,Demo Tenant SA',
    ].join('\n');

    const parsed = parseCredentialsCsvText(csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.AFIP_USERNAME).toBe('20999888776');
  });
});
