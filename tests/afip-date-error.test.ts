import { describe, expect, test } from 'vitest';
import { extractAfipDateValidationError } from '../invoice-issuer';

describe('extractAfipDateValidationError — period / payment-due messages', () => {
  test('detects a payment-due-before-emission message', () => {
    const message = extractAfipDateValidationError(
      'Error: El Vencimiento para el pago no puede ser anterior a la fecha del comprobante.',
    );
    expect(message).toContain('AFIP rejected invoice dates');
    expect(message).toContain('vencimiento para el pago');
  });

  test('detects an invalid periodo facturado message (accent-insensitive)', () => {
    const message = extractAfipDateValidationError(
      'La fecha ingresada en Período Facturado Desde no puede ser posterior a la fecha Hasta.',
    );
    expect(message).toContain('AFIP rejected invoice dates');
  });

  test('plain form labels never produce a false positive', () => {
    const formText = [
      'Fecha del Comprobante (*)',
      'Período Facturado Desde (*)',
      'Período Facturado Hasta (*)',
      'Vencimiento para el pago (*)',
      'Continuar >',
    ].join('\n');
    expect(extractAfipDateValidationError(formText)).toBeUndefined();
  });

  test('problem phrases without a date-field context are ignored', () => {
    expect(
      extractAfipDateValidationError('La CUIT ingresada es invalida.'),
    ).toBeUndefined();
  });

  test('a non-date error near form labels on other lines is not misclassified', () => {
    // The error banner and the (always-present) field labels render on
    // separate lines: same-line matching must not cross them.
    const pageText = [
      'El valor del campo Concepto es invalido.',
      'Fecha del Comprobante (*)',
      'Período Facturado Desde (*)',
      'Vencimiento para el pago (*)',
    ].join('\n');
    expect(extractAfipDateValidationError(pageText)).toBeUndefined();
  });

  test('the specific fecha-del-comprobante message keeps its original wording', () => {
    const message = extractAfipDateValidationError(
      'La Fecha del Comprobante es inválida: es anterior al Inicio de Actividades.',
    );
    expect(message).toBe(
      'AFIP rejected invoice date: La Fecha del Comprobante es invalida (es anterior al Inicio de Actividades o existen comprobantes emitidos con fecha posterior a la ingresada)',
    );
  });
});
