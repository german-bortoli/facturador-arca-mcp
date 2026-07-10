import { describe, expect, test } from 'vitest';
import { resolveServicePeriod } from '../utils/service-period';

const EMISSION = '08/07/2026' as const;

function date(display: string): Date {
  const [d, m, y] = display.split('/').map(Number);
  return new Date(y!, m! - 1, d!);
}

describe('resolveServicePeriod', () => {
  test('no CSV dates: defaults to the emission month (pre-2026 behavior)', () => {
    const result = resolveServicePeriod({}, EMISSION);
    expect(result.serviceFrom).toBe('01/07/2026');
    expect(result.serviceTo).toBe('31/07/2026');
    expect(result.paymentDue).toBe('31/07/2026');
    expect(result.warnings).toEqual([]);
  });

  test('explicit valid past period is honored, payment due derived', () => {
    const result = resolveServicePeriod(
      {
        FECHA_SERVICIO_DESDE: date('01/06/2026'),
        FECHA_SERVICIO_HASTA: date('30/06/2026'),
      },
      EMISSION,
    );
    expect(result.serviceFrom).toBe('01/06/2026');
    expect(result.serviceTo).toBe('30/06/2026');
    expect(result.paymentDue).toBe('31/07/2026');
    expect(result.warnings).toEqual([]);
  });

  test('inverted period falls back to the emission month with a warning', () => {
    const result = resolveServicePeriod(
      {
        FECHA_SERVICIO_DESDE: date('30/06/2026'),
        FECHA_SERVICIO_HASTA: date('01/06/2026'),
      },
      EMISSION,
    );
    expect(result.serviceFrom).toBe('01/07/2026');
    expect(result.serviceTo).toBe('31/07/2026');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Período de servicio inválido');
  });

  test('payment due before the emission date is clamped (AFIP always rejects it)', () => {
    const result = resolveServicePeriod(
      { FECHA_VTO_PAGO: date('10/02/2026') },
      EMISSION,
    );
    expect(result.paymentDue).toBe('31/07/2026');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('FECHA_VTO_PAGO');
  });

  test('payment due on or after the emission date is honored', () => {
    expect(
      resolveServicePeriod({ FECHA_VTO_PAGO: date('08/07/2026') }, EMISSION).paymentDue,
    ).toBe('08/07/2026');
    expect(
      resolveServicePeriod({ FECHA_VTO_PAGO: date('15/08/2026') }, EMISSION).paymentDue,
    ).toBe('15/08/2026');
  });

  test('invalid emission date falls back to today with a warning', () => {
    const result = resolveServicePeriod({}, 'not-a-date' as never);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.serviceFrom).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
