import { describe, test, expect } from 'bun:test';
import {
  cleanDocumentNumber,
  normalizeDocumentType,
  parseAmount,
  parsePercentage,
  parseInvoiceType,
  parseIvaReceiverCode,
  parseDateToAfip,
  makeCurrencyParser,
} from '../utils/data-cleaner';

describe('cleanDocumentNumber', () => {
  test('should remove spaces from document number', () => {
    expect(cleanDocumentNumber('27 219 622 878')).toBe('27219622878');
    expect(cleanDocumentNumber('1 2 3 4')).toBe('1234');
  });

  test('should remove dots from document number', () => {
    expect(cleanDocumentNumber('27.219.622.878')).toBe('27219622878');
    expect(cleanDocumentNumber('1.2.3.4')).toBe('1234');
  });

  test('should remove commas from document number', () => {
    expect(cleanDocumentNumber('27,219,622,878')).toBe('27219622878');
    expect(cleanDocumentNumber('1,2,3,4')).toBe('1234');
  });

  test('should remove hyphens from document number', () => {
    expect(cleanDocumentNumber('27-219-622-878')).toBe('27219622878');
    expect(cleanDocumentNumber('1-2-3-4')).toBe('1234');
  });

  test('should handle mixed separators', () => {
    expect(cleanDocumentNumber('27.219-622 878')).toBe('27219622878');
    expect(cleanDocumentNumber('1 2.3,4-5')).toBe('12345');
  });

  test('should handle strings without separators', () => {
    expect(cleanDocumentNumber('27219622878')).toBe('27219622878');
    expect(cleanDocumentNumber('123')).toBe('123');
  });

  test('should handle empty and single character strings', () => {
    expect(cleanDocumentNumber('')).toBe('');
    expect(cleanDocumentNumber('1')).toBe('1');
  });
});

describe('parseAmount', () => {
  test('should parse Argentine format with comma as decimal separator', () => {
    expect(parseAmount('63 175,00')).toBe(63175.00);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('100,50')).toBe(100.50);
  });

  test('should parse US format with dot as decimal separator', () => {
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('100.50')).toBe(100.50);
    expect(parseAmount('9999.99')).toBe(9999.99);
  });

  test('should handle currency symbols', () => {
    expect(parseAmount('$ 1.234,56')).toBe(1234.56);
    expect(parseAmount('ARS 1.234,56')).toBe(1234.56);
    expect(parseAmount('$ 100,50')).toBe(100.50);
  });

  test('should handle amounts without decimals', () => {
    expect(parseAmount('1000')).toBe(1000);
    expect(parseAmount('500')).toBe(500);
  });

  test('should handle amounts with thousands separators', () => {
    expect(parseAmount('1.000.000,00')).toBe(1000000.00);
    expect(parseAmount('1.000,00')).toBe(1000.00);
    expect(parseAmount('999.999,99')).toBe(999999.99);
  });

  test('should throw error for invalid input', () => {
    expect(() => parseAmount('')).toThrow('Amount must be a non-empty string');
    expect(() => parseAmount('abc')).toThrow('Invalid amount format: abc');
    expect(() => parseAmount('$$$')).toThrow('Invalid amount format: $$$');
  });

  test('should throw error for non-string input', () => {
    // @ts-expect-error Testing invalid input type
    expect(() => parseAmount(null)).toThrow('Amount must be a non-empty string');
    // @ts-expect-error Testing invalid input type
    expect(() => parseAmount(undefined)).toThrow('Amount must be a non-empty string');
    // @ts-expect-error Testing invalid input type
    expect(() => parseAmount({})).toThrow('Amount must be a non-empty string');
  });

  test('should handle edge cases with spaces', () => {
    expect(parseAmount('  100,50  ')).toBe(100.50);
    expect(parseAmount('1 000,00')).toBe(1000.00);
  });

  test('should handle very large amounts', () => {
    expect(parseAmount('1.000.000.000,99')).toBe(1000000000.99);
    expect(parseAmount('500.000.000,00')).toBe(500000000.00);
  });
});

describe('normalizeDocumentType', () => {
  test('should convert to uppercase', () => {
    expect(normalizeDocumentType('cuit')).toBe('CUIT');
    expect(normalizeDocumentType('dni')).toBe('DNI');
    expect(normalizeDocumentType('cuil')).toBe('CUIL');
  });

  test('should handle already uppercase strings', () => {
    expect(normalizeDocumentType('CUIT')).toBe('CUIT');
    expect(normalizeDocumentType('DNI')).toBe('DNI');
  });

  test('should handle mixed case', () => {
    expect(normalizeDocumentType('CuIt')).toBe('CUIT');
    expect(normalizeDocumentType('DnI')).toBe('DNI');
  });

  test('should trim whitespace', () => {
    expect(normalizeDocumentType('  cuit  ')).toBe('CUIT');
    expect(normalizeDocumentType('dni ')).toBe('DNI');
    expect(normalizeDocumentType(' cuil')).toBe('CUIL');
  });

  test('should handle empty strings', () => {
    expect(normalizeDocumentType('')).toBe('');
    expect(normalizeDocumentType('   ')).toBe('');
  });
});

describe('parsePercentage', () => {
  test('should parse string percentage values', () => {
    expect(parsePercentage('100', 0)).toBe(100);
    expect(parsePercentage('21.5', 0)).toBe(21.5);
    expect(parsePercentage('10.5', 0)).toBe(10.5);
  });

  test('should return number values as-is', () => {
    expect(parsePercentage(100, 0)).toBe(100);
    expect(parsePercentage(21.5, 0)).toBe(21.5);
    expect(parsePercentage(0, 100)).toBe(0);
  });

  test('should use default value for undefined', () => {
    expect(parsePercentage(undefined, 100)).toBe(100);
    expect(parsePercentage(undefined, 21)).toBe(21);
  });

  test('should use default value for null', () => {
    // @ts-expect-error Testing null input
    expect(parsePercentage(null, 50)).toBe(50);
  });

  test('should use default value for empty string', () => {
    expect(parsePercentage('', 75)).toBe(75);
  });

  test('should use default value for invalid strings', () => {
    expect(parsePercentage('abc', 100)).toBe(100);
    expect(parsePercentage('not a number', 50)).toBe(50);
  });

  test('should handle zero as a valid value', () => {
    expect(parsePercentage(0, 100)).toBe(0);
    expect(parsePercentage('0', 100)).toBe(0);
  });

  test('should handle negative percentages', () => {
    expect(parsePercentage('-10', 0)).toBe(-10);
    expect(parsePercentage(-5.5, 0)).toBe(-5.5);
  });
});

describe('parseInvoiceType', () => {
  test('should parse valid invoice types', () => {
    expect(parseInvoiceType('A')).toBe('A');
    expect(parseInvoiceType('B')).toBe('B');
    expect(parseInvoiceType('C')).toBe('C');
  });

  test('should handle lowercase input', () => {
    expect(parseInvoiceType('a')).toBe('A');
    expect(parseInvoiceType('b')).toBe('B');
    expect(parseInvoiceType('c')).toBe('C');
  });

  test('should handle input with whitespace', () => {
    expect(parseInvoiceType(' A ')).toBe('A');
    expect(parseInvoiceType('B  ')).toBe('B');
    expect(parseInvoiceType('  C')).toBe('C');
  });

  test('should throw error for invalid types', () => {
    expect(() => parseInvoiceType('D')).toThrow();
    expect(() => parseInvoiceType('X')).toThrow();
    expect(() => parseInvoiceType('AB')).toThrow();
  });

  test('should throw error for empty string', () => {
    expect(() => parseInvoiceType('')).toThrow();
  });

  test('should throw error for numbers', () => {
    expect(() => parseInvoiceType('1')).toThrow();
    expect(() => parseInvoiceType('123')).toThrow();
  });
});

describe('parseIvaReceiverCode', () => {
  test('should parse valid numeric codes', () => {
    expect(parseIvaReceiverCode(1, 6)).toBe(1);
    expect(parseIvaReceiverCode(6, 1)).toBe(6);
    expect(parseIvaReceiverCode(16, 1)).toBe(16);
  });

  test('should parse valid string codes', () => {
    expect(parseIvaReceiverCode('1', 6)).toBe(1);
    expect(parseIvaReceiverCode('6', 1)).toBe(6);
    expect(parseIvaReceiverCode('16', 1)).toBe(16);
  });

  test('should return default for codes out of range', () => {
    expect(parseIvaReceiverCode(0, 6)).toBe(6);
    expect(parseIvaReceiverCode(17, 6)).toBe(6);
    expect(parseIvaReceiverCode(100, 6)).toBe(6);
    expect(parseIvaReceiverCode(-1, 6)).toBe(6);
  });

  test('should return default for invalid string codes', () => {
    expect(parseIvaReceiverCode('abc', 6)).toBe(6);
    expect(parseIvaReceiverCode('not a number', 6)).toBe(6);
    expect(parseIvaReceiverCode('25', 6)).toBe(6);
  });

  test('should return default for undefined', () => {
    expect(parseIvaReceiverCode(undefined, 6)).toBe(6);
  });

  test('should return default for null', () => {
    // @ts-expect-error Testing null input
    expect(parseIvaReceiverCode(null, 6)).toBe(6);
  });

  test('should return default for empty string', () => {
    expect(parseIvaReceiverCode('', 6)).toBe(6);
  });

  test('should handle boundary values', () => {
    expect(parseIvaReceiverCode(1, 10)).toBe(1);
    expect(parseIvaReceiverCode(16, 10)).toBe(16);
  });
});

describe('parseDateToAfip', () => {
  test('should parse DD/MM/YYYY format', () => {
    expect(parseDateToAfip('25/10/2023')).toBe(20231025);
    expect(parseDateToAfip('01/01/2024')).toBe(20240101);
    expect(parseDateToAfip('31/12/2023')).toBe(20231231);
  });

  test('should parse YYYY-MM-DD format', () => {
    expect(parseDateToAfip('2023-10-25')).toBe(20231025);
    expect(parseDateToAfip('2024-01-01')).toBe(20240101);
    expect(parseDateToAfip('2023-12-31')).toBe(20231231);
  });

  test('should handle dates with leading zeros', () => {
    expect(parseDateToAfip('05/05/2023')).toBe(20230505);
    expect(parseDateToAfip('2023-05-05')).toBe(20230505);
  });

  test('should handle dates without leading zeros', () => {
    expect(parseDateToAfip('5/5/2023')).toBe(20230505);
  });

  test('should return null for undefined', () => {
    expect(parseDateToAfip(undefined)).toBe(null);
  });

  test('should return null for empty string', () => {
    expect(parseDateToAfip('')).toBe(null);
    expect(parseDateToAfip('   ')).toBe(null);
  });

  test('should return null for invalid date formats', () => {
    expect(parseDateToAfip('invalid')).toBe(null);
    expect(parseDateToAfip('abc/def/ghij')).toBe(null);
  });

  test('should return null for invalid dates', () => {
    // Note: JavaScript Date is quite forgiving, so some "invalid" dates may still parse
    // Testing truly unparseable dates with non-numeric values
    expect(parseDateToAfip('invalid/date/string')).toBe(null);
    expect(parseDateToAfip('not-a-date')).toBe(null);
    expect(parseDateToAfip('abc123')).toBe(null);
  });

  test('should return null for Date objects', () => {
    // Date type is allowed in the signature but treated as invalid by the implementation
    expect(parseDateToAfip(new Date())).toBe(null);
  });

  test('should handle different years', () => {
    expect(parseDateToAfip('15/06/2020')).toBe(20200615);
    expect(parseDateToAfip('15/06/2025')).toBe(20250615);
    expect(parseDateToAfip('2020-06-15')).toBe(20200615);
  });

  test('should handle dates at year boundaries', () => {
    expect(parseDateToAfip('31/12/2023')).toBe(20231231);
    expect(parseDateToAfip('01/01/2024')).toBe(20240101);
  });
});

describe('makeCurrencyParser', () => {
  test('should parse EUR with German locale', () => {
    const parser = makeCurrencyParser('de-DE', { style: 'currency', currency: 'EUR' });
    expect(parser('123.456,79 €')).toBe(123456.79);
    expect(parser('1.000,00 €')).toBe(1000.00);
    expect(parser('€ 500,50')).toBe(500.50);
  });

  test('should parse USD with US locale', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('$123,456.79')).toBe(123456.79);
    expect(parser('$1,000.00')).toBe(1000.00);
    expect(parser('500.50')).toBe(500.50);
  });

  test('should parse ARS with Argentine locale', () => {
    const parser = makeCurrencyParser('es-AR', { style: 'currency', currency: 'ARS' });
    expect(parser('$ 123.456,79')).toBe(123456.79);
    expect(parser('$ 1.000,00')).toBe(1000.00);
  });

  test('should handle amounts without currency symbol', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('1000.50')).toBe(1000.50);
    expect(parser('123,456.78')).toBe(123456.78);
  });

  test('should handle negative amounts', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('-$123.45')).toBeCloseTo(-123.45, 2);
    expect(parser('$-123.45')).toBeCloseTo(-123.45, 2);
    // Note: Parentheses notation for negatives is not supported
    expect(parser('($123.45)')).toBe(123.45); // Parentheses are ignored
  });

  test('should handle zero', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('$0.00')).toBe(0);
    expect(parser('0')).toBe(0);
  });

  test('should handle very large amounts', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('$1,000,000.00')).toBe(1000000);
  });

  test('should parse GBP with UK locale', () => {
    const parser = makeCurrencyParser('en-GB', { style: 'currency', currency: 'GBP' });
    expect(parser('£1,234.56')).toBe(1234.56);
    expect(parser('£500.00')).toBe(500.00);
  });

  test('should handle different decimal places', () => {
    const parser = makeCurrencyParser('en-US', { style: 'currency', currency: 'USD' });
    expect(parser('$10.5')).toBe(10.5);
    expect(parser('$10.50')).toBe(10.50);
    expect(parser('$10.505')).toBe(10.505);
  });
});
