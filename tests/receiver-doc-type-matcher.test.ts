import { describe, expect, test } from 'vitest';
import { matchReceiverDocumentTypeOption } from '../invoice-issuer';

const PORTAL_OPTIONS = [
  { index: 0, value: '', text: 'Seleccionar...' },
  { index: 1, value: '80', text: 'CUIT' },
  { index: 2, value: '86', text: 'CUIL' },
  { index: 3, value: '96', text: 'DNI' },
];

describe('matchReceiverDocumentTypeOption', () => {
  test('matches by option value first', () => {
    const matched = matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 80, 'CUIT');
    expect(matched?.value).toBe('80');
  });

  test('falls back to label match when option values are not AFIP codes', () => {
    const options = [
      { index: 0, value: '1', text: 'CUIT' },
      { index: 1, value: '2', text: 'DNI' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 96, 'dni');
    expect(matched?.text).toBe('DNI');
  });

  test('an empty label does NOT match every option (pre-fix bug)', () => {
    expect(matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 99, '')).toBeUndefined();
  });

  test('doc type 99 matches a literal 99 option by value', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '99', text: 'Sin identificar/venta global diaria' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, '');
    expect(matched?.value).toBe('99');
  });

  test('doc type 99 falls back to the portal "unidentified" labels', () => {
    const options = [
      ...PORTAL_OPTIONS,
      { index: 4, value: '12', text: 'Otro (sin identificar)' },
    ];
    const matched = matchReceiverDocumentTypeOption(options, 99, '');
    expect(matched?.index).toBe(4);
  });

  test('unmatched identified doc type returns undefined so the caller fails loud', () => {
    expect(
      matchReceiverDocumentTypeOption(PORTAL_OPTIONS, 94, 'PASAPORTE'),
    ).toBeUndefined();
  });
});
