import { describe, expect, test } from 'vitest';
import { matchReceiverDocumentTypeOption } from '../invoice-issuer';

const PORTAL_OPTIONS = [
  { index: 0, value: '', text: 'Seleccionar...' },
  { index: 1, value: '80', text: 'CUIT' },
  { index: 2, value: '86', text: 'CUIL' },
  { index: 3, value: '96', text: 'DNI' },
];

describe('matchReceiverDocumentTypeOption — identified types', () => {
  test('matches by option value first', () => {
    const matched = matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 80, 'CUIT', true);
    expect(matched?.value).toBe('80');
  });

  test('falls back to label match when option values are not AFIP codes', () => {
    const options = [
      { index: 0, value: '1', text: 'CUIT' },
      { index: 1, value: '2', text: 'DNI' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 96, 'dni', true);
    expect(matched?.text).toBe('DNI');
  });

  test('unmatched identified doc type returns undefined so the caller fails loud', () => {
    expect(
      matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 94, 'PASAPORTE', true),
    ).toBeUndefined();
  });
});

describe('matchReceiverDocumentTypeOption — unidentified receiver (99, no number)', () => {
  test('an empty label does NOT match every option (pre-fix bug)', () => {
    expect(
      matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 99, '', false),
    ).toBeUndefined();
  });

  test('matches a literal 99 option by value', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '99', text: 'Sin identificar/venta global diaria' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, '', false);
    expect(matched?.value).toBe('99');
  });

  test('falls back to the portal "unidentified" labels', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '12', text: 'Otro (sin identificar)' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, '', false);
    expect(matched?.index).toBe(4);
  });

  test('ignores a stray CSV label: a PASAPORTE row with no number resolves to "Sin identificar"', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '94', text: 'Pasaporte' },
      { index: 5, value: '99', text: 'Sin identificar/venta global diaria' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, 'PASAPORTE', false);
    expect(matched?.value).toBe('99');
  });
});

describe('matchReceiverDocumentTypeOption — doc type 99 WITH a document number', () => {
  test('matches by label only: never diverts a numbered PASAPORTE row to "Sin identificar"', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '94', text: 'Pasaporte' },
      { index: 5, value: '99', text: 'Sin identificar/venta global diaria' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, 'PASAPORTE', true);
    expect(matched?.text).toBe('Pasaporte');
  });

  test('numbered row with an empty label returns undefined instead of the 99 fallback', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '99', text: 'Sin identificar/venta global diaria' },
    ];
    expect(matchReceiverDocumentTypeOption(options, 99, '', true)).toBeUndefined();
  });

  test('numbered row whose label is not offered returns undefined so the caller fails loud', () => {
    expect(
      matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 99, 'CDI', true),
    ).toBeUndefined();
  });
});
