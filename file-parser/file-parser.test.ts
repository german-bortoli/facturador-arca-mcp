import {describe,test,expect} from 'bun:test';
import { FileParser } from '.';
import { ColumnsSchema } from '../types/file';
import z from 'zod';


describe('FileParser', () => {
  const parser = new FileParser();

  test('should throw error if file extension is not allowed', () => {
    expect(() => parser.parse('test.txt')).toThrow('Invalid file extension');
  });


  ['csv', 'xlsx'].forEach(ext => {
    test(`should validate file extension ${ext}`, async () => {
      const file = Bun.file(`./csv/test.${ext}`);
      expect(await file.exists()).toBe(true);
      const r = parser['validateFileExtension'](file);
      expect(r.type).toBeDefined();
      const expectedExt = ext === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      expect(r.type).toBe(expectedExt);
    });
  });


  ['csv', 'xlsx'].forEach(ext => {
  test(`Should parse ${ext} file to expected columns`, async () => {
    const r = await parser.parse(`./csv/test.xlsx`, {schema: ColumnsSchema.array()});
    expect(r).toBeDefined();
    expect(r).toHaveProperty('invalid');
    expect(r).toHaveProperty('valid');
    expect(r.valid.length).toBeGreaterThan(1);
    r.valid.forEach(row => {
      Object.keys(ColumnsSchema.shape).forEach(key => {
        const MANDATORY_FIELDS = ['NOMBRE', 'TIPO_DOCUMENTO', 'NUMERO', 'DIRECCION', 'TOTAL'];
        const value = row[key as keyof typeof row];
        // Leave out fields that are not there and are optional.
          if(MANDATORY_FIELDS.includes(key)) {
            expect(value).toBeDefined();
          }
      });
    });
// Invalid ones should not pass the schema validation
    r.invalid.forEach(row => {
      expect(ColumnsSchema.parse(row)).toThrow();
    });
  });
});
  
  
});
