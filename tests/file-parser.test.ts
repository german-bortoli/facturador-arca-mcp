import { describe, test, expect } from 'vitest';
import { FileParser } from '../file-parser';
import { ColumnsSchema } from '../types/file';

describe('FileParser', () => {
  const parser = new FileParser();

  test('throws error for unsupported extension', async () => {
    await expect(parser.parse('test.txt')).rejects.toThrow('Invalid file extension');
  });

  test('parses canonical csv fixture', async () => {
    const result = await parser.parse('./assets/canonical-example.csv', { schema: ColumnsSchema });
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('invalid');
    expect(result.valid.length).toBeGreaterThan(0);
  });

  test('parses csv without schema', async () => {
    const result = await parser.parse('./assets/canonical-example.csv');
    expect(Array.isArray(result.valid)).toBe(true);
    expect(result.invalid.length).toBe(0);
  });
});
