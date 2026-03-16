import { invariant } from '@epic-web/invariant';
import type { ParseXlsxOptions, ParseCsvOptions } from '../types/file';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import z from 'zod';

export class FileParser {
  private allowedExtensions = ['.csv', '.xlsx'];

  private validateFileExtension(filePath: string): '.csv' | '.xlsx' {
    invariant(filePath, 'File not provided');
    const extension = extname(filePath).toLowerCase();
    invariant(this.allowedExtensions.includes(extension), 'Invalid file extension');
    return extension as '.csv' | '.xlsx';
  }


  private async parseCsv(buffer: ArrayBufferLike, options?: ParseCsvOptions) {
    const {
      headerRow = true,
      includeEmptyRows = false,
      headerMapping = {
        'TIPO DOCUMENTO': 'TIPO_DOCUMENTO',
      }
    } = options ?? {};

    // Parse CSV based on options
    if (headerRow) {
      // Convert to array of objects with headers
      const jsonData = parse(new TextDecoder().decode(buffer), {
        columns: true,
        skip_empty_lines: !includeEmptyRows,
        cast: false,
      }) as Record<string, unknown>[];

      // Apply header mapping if provided
      if (headerMapping) {
        const mappedData = jsonData.map((row) => {
          const mappedRow: Record<string, unknown> = {};
          const headers = Object.keys(row);
          headers.forEach((header) => {
            const mappedHeader = headerMapping[header] ?? header;
            mappedRow[mappedHeader] = row[header];
          });
          return mappedRow;
        });

        // Filter empty rows if needed
        if (!includeEmptyRows) {
          return mappedData.filter((row) =>
            Object.values(row).some((value) => value !== null && value !== '' && value !== undefined)
          );
        }

        return mappedData;
      }

      // Filter empty rows if needed
      if (!includeEmptyRows) {
        return jsonData.filter((row) =>
          Object.values(row).some((value) => value !== null && value !== '' && value !== undefined)
        );
      }

      return jsonData;
    }

    // Convert to array of arrays
    const jsonData = parse(new TextDecoder().decode(buffer), {
      columns: false,
      skip_empty_lines: !includeEmptyRows,
      cast: false,
    }) as unknown[][];

    // Filter empty rows if needed
    if (!includeEmptyRows) {
      return jsonData.filter((row) =>
        row.some((cell) => cell !== null && cell !== '' && cell !== undefined)
      );
    }

    return jsonData;
  }

  private async parseXlsx(buffer: ArrayBufferLike, options?: ParseXlsxOptions) {

    const {
      sheetName,
      headerRow = true,
      includeEmptyRows = false,
      headerMapping = {
        'TIPO DOCUMENTO': 'TIPO_DOCUMENTO',
      }
    } = options ?? {};

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    // Get the sheet to parse
    const sheet = sheetName
      ? workbook.Sheets[sheetName]
      : workbook.Sheets[workbook.SheetNames[0] ?? ''];

    invariant(sheet, sheetName
      ? `Sheet "${sheetName}" not found in workbook`
      : 'No sheets found in workbook');


    // Convert to JSON based on options
    if (headerRow) {
      // Convert to array of objects with headers
      const jsonData = XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false,
        rawNumbers: false,
      }) as Record<string, unknown>[];

      // Apply header mapping if provided
      if (headerMapping) {
        return jsonData.map((row) => {
          const mappedRow: Record<string, unknown> = {};
          const headers = Object.keys(row);
          headers.forEach((header) => {
            const mappedHeader = headerMapping[header] ?? header;
            mappedRow[mappedHeader] = row[header];
          });
          return mappedRow;
        });
      }

      // Filter empty rows if needed
      if (!includeEmptyRows) {
        return jsonData.filter((row) =>
          Object.values(row).some((value) => value !== null && value !== '')
        );
      }

      return jsonData;
    }

    // Convert to array of arrays
    const jsonData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      raw: false,
    }) as unknown[][];

    // Filter empty rows if needed
    if (!includeEmptyRows) {
      return jsonData.filter((row) =>
        row.some((cell) => cell !== null && cell !== '')
      );
    }

    return jsonData;

  }

  validateColumns<T>(data: unknown, schema: z.ZodSchema<T>) {
    const c = schema.safeParse(data)
    if (c.error) {
      throw new Error(`Invalid columns: ${z.prettifyError(c.error)}`);
    }
    return c.data;
  }

  /**
   * Filters an array of data, keeping only rows that match the schema
   * @param data - Array of data to filter
   * @param itemSchema - Zod schema for individual items
   * @returns Array of valid, typed rows
   */
  filterValidRows<T>(data: unknown[], itemSchema: z.ZodSchema<T>): { valid: T[], invalid: unknown[] } {
    const valid: T[] = [];
    const invalid: unknown[] = [];

    data.forEach((row) => {
      try {
        const result = itemSchema.safeParse(row);

        if (result.success) {
          valid.push(result.data);
        } else {
          invalid.push(row);
        }
      } catch {
        invalid.push(row);
      }
    });

    return { valid, invalid };
  }

  /**
   * Parses a CSV or XLSX file with schema validation
   * @param filePath - Path to the file to parse
   * @param opts - Options including schema for validation
   * @returns Validated and typed data when schema is provided, raw data otherwise
   */
  async parse<T>(filePath: string, opts: { csv?: ParseCsvOptions, xlsx?: ParseXlsxOptions, schema: z.ZodSchema<T>, filterInvalid?: boolean }): Promise<{ valid: T[], invalid: unknown[] }>;
  async parse(filePath: string, opts?: { csv?: ParseCsvOptions, xlsx?: ParseXlsxOptions }): Promise<{ valid: Record<string, unknown>[] | unknown[][], invalid: unknown[] }>;
  async parse<T>(filePath: string, opts?: { csv?: ParseCsvOptions, xlsx?: ParseXlsxOptions, schema?: z.ZodSchema<T>, filterInvalid?: boolean }): Promise<{ valid: T[] | Record<string, unknown>[] | unknown[][], invalid: unknown[] }> {
    const extension = this.validateFileExtension(filePath);
    const fileBuffer = await readFile(filePath);
    const buffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    );

    let rows: { valid: T[] | Record<string, unknown>[] | unknown[][], invalid: unknown[] } = { valid: [], invalid: [] };

    switch (extension) {
      case '.csv':
        if (opts?.schema) {
          rows = this.filterValidRows(await this.parseCsv(buffer, opts?.csv), opts.schema);
        } else {
          rows = { valid: await this.parseCsv(buffer, opts?.csv), invalid: [] };
        }
        break;
      case '.xlsx':
        if (opts?.schema) {
          rows = this.filterValidRows(await this.parseXlsx(buffer, opts?.xlsx), opts.schema);
        } else {
          rows = { valid: await this.parseXlsx(buffer, opts?.xlsx), invalid: [] };
        }
        break;
      default:
        throw new Error('Invalid file type');
    }

    return rows;
  }
}
