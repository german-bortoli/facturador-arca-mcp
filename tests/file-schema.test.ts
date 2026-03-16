import { describe, expect, test } from 'vitest';
import { ColumnsSchema } from '../types/file';

describe('ColumnsSchema date parsing', () => {
  test('accepts dd/MM/yyyy service/payment dates', () => {
    const parsed = ColumnsSchema.parse({
      NOMBRE: 'Test User',
      DOMICILIO: 'Street 123',
      TIPO_DOCUMENTO: 'DNI',
      NUMERO: '12345678',
      CONCEPTO: 'Service',
      TOTAL: '150',
      FECHA_SERVICIO_DESDE: '01/03/2026',
      FECHA_SERVICIO_HASTA: '31/03/2026',
      FECHA_VTO_PAGO: '31/03/2026',
    });

    expect(parsed.FECHA_SERVICIO_DESDE).toBeInstanceOf(Date);
    expect(parsed.FECHA_SERVICIO_HASTA).toBeInstanceOf(Date);
    expect(parsed.FECHA_VTO_PAGO).toBeInstanceOf(Date);
  });

  test('accepts yyyy-MM-dd service/payment dates', () => {
    const parsed = ColumnsSchema.parse({
      NOMBRE: 'Test User',
      DOMICILIO: 'Street 123',
      TIPO_DOCUMENTO: 'DNI',
      NUMERO: '12345678',
      CONCEPTO: 'Service',
      TOTAL: '150',
      FECHA_SERVICIO_DESDE: '2026-03-01',
      FECHA_SERVICIO_HASTA: '2026-03-31',
      FECHA_VTO_PAGO: '2026-03-31',
    });

    expect(parsed.FECHA_SERVICIO_DESDE).toBeInstanceOf(Date);
    expect(parsed.FECHA_SERVICIO_HASTA).toBeInstanceOf(Date);
    expect(parsed.FECHA_VTO_PAGO).toBeInstanceOf(Date);
  });
});
