import { describe, test, expect } from 'vitest';
import { FileParser } from '../file-parser';
import { ColumnsSchema } from '../types/file';
import * as XLSX from 'xlsx';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('FileParser', () => {
  const parser = new FileParser();

  test('throws error for unsupported extension', async () => {
    await expect(parser.parse('test.txt')).rejects.toThrow('Invalid file extension');
  });

  test('parses csv with schema', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-facturador-csv-test-'));
    const filePath = join(tempDir, 'input.csv');
    const csv = [
      'NOMBRE,TIPO DOCUMENTO,NUMERO,CONCEPTO,TOTAL',
      'Cliente Test,DNI,12345678,Servicio profesional,1000',
    ].join('\n');
    try {
      await writeFile(filePath, csv, 'utf8');
      const result = await parser.parse(filePath, { schema: ColumnsSchema });
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('invalid');
      expect(result.valid.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('parses csv without schema', async () => {
    const result = await parser.parse('./csv/example.csv');
    expect(Array.isArray(result.valid)).toBe(true);
    expect(result.invalid.length).toBe(0);
  });

  test('parses xlsx with schema', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), '.tmp-facturador-xlsx-test-'));
    const filePath = join(tempDir, 'input.xlsx');
    try {
      const worksheet = XLSX.utils.json_to_sheet([
        {
          NOMBRE: 'Cliente Test',
          'TIPO DOCUMENTO': 'DNI',
          NUMERO: '12345678',
          CONCEPTO: 'Servicio profesional',
          TOTAL: 1000,
        },
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const workbookBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await writeFile(filePath, workbookBuffer);

      const result = await parser.parse(filePath, { schema: ColumnsSchema });
      expect(result.invalid.length).toBe(0);
      expect(result.valid.length).toBe(1);
      expect(result.valid[0]!.NOMBRE).toBe('Cliente Test');
      expect(result.valid[0]!.TIPO_DOCUMENTO).toBe('DNI');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
