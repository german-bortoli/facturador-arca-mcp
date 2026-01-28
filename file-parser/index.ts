import { invariant } from '@epic-web/invariant';
import type { ParseXlsxOptions, ParseCsvOptions } from '../types/file';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import mime from 'mime-types';
import z from 'zod';

export class FileParser {
  private allowedExtensions = ['csv', 'xlsx'].map(e => mime.lookup(e));
  /**
   * Reads a file and returns its content based on the specified format
   */
  private async readFile<T extends Record<string, unknown>>(f: Bun.BunFile, config: { as: 'json' }): Promise<T>;
  private async readFile(f: Bun.BunFile, config: { as: 'text' }): Promise<string>;
  private async readFile(f: Bun.BunFile, config?: { as: 'arrayBuffer' }): Promise<ArrayBuffer>;
  private async readFile<T extends Record<string, unknown>>(
    f: Bun.BunFile,
    { as }: { as: 'text' | 'json' | 'arrayBuffer' } = { as: 'arrayBuffer' }
  ): Promise<T | string | ArrayBuffer> {
    if (as === 'text') {
      return f.text();
    }
    if (as === 'json') {
      return f.json() as Promise<T>;
    }
    if (as === 'arrayBuffer') {
      return f.arrayBuffer();
    }
    throw new Error('Invalid format specified');
  }

  private validateFileExtension(file: Bun.BunFile) {
    invariant(file, 'File not provided');
    invariant(this.allowedExtensions.includes(file.type), 'Invalid file extension');
    return file;
  }


  private async parseCsv(buffer: ArrayBuffer, options?: ParseCsvOptions) {
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

  private async parseXlsx(buffer: ArrayBuffer, options?: ParseXlsxOptions) {

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
  async parse(filePath: string, opts?: { csv?: ParseCsvOptions, xlsx?: ParseXlsxOptions }): Promise<{ valid: Record<string, unknown>[][], invalid: unknown[] }>;
  async parse<T>(filePath: string, opts?: { csv?: ParseCsvOptions, xlsx?: ParseXlsxOptions, schema?: z.ZodSchema<T>, filterInvalid?: boolean }): Promise<{ valid: T[] | Record<string, unknown>[] | unknown[][], invalid: unknown[] }> {
    const file = Bun.file(filePath);
    this.validateFileExtension(file);
    const f = await this.readFile(file);

    let rows: { valid: T[] | Record<string, unknown>[] | unknown[][], invalid: unknown[] } = { valid: [], invalid: [] };

    switch (mime.extension(file.type)) {
      case 'csv':
        if (opts?.schema) {
          rows = this.filterValidRows(await this.parseCsv(f, opts?.csv), opts.schema);
        } else {
          rows = { valid: await this.parseCsv(f, opts?.csv), invalid: [] };
        }
        break;
      case 'xlsx':
        if (opts?.schema) {
          rows = this.filterValidRows(await this.parseXlsx(f, opts?.xlsx), opts.schema);
        } else {
          rows = { valid: await this.parseXlsx(f, opts?.xlsx), invalid: [] };
        }
        break;
      default:
        throw new Error('Invalid file type');
    }

    return rows;
  }
}

// Read the file
// get the file extension,, throw for non csv or xlsx
// if its a xlsx, use first sheet if no sheet is specificed on read file.
// parse the file and return a json with types
