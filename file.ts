import { parseArgs } from 'node:util';
import { FileParser } from './file-parser';
import { ColumnsSchema } from './types/file';
import { invariant } from '@epic-web/invariant';


const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    now: {
      type: 'boolean',
      default: false,
    },
    date: {
      type: 'string',
      short: 'd',
    },
    file: {
      type: 'string',
      short: 'f',
      default: `./${process.env.FILE}`,
    },
    sheet: {
      type: 'string',
      short: 's',
    },
  },
  strict: true,
  allowPositionals: true,
});


/**
 * Formats and logs data in a readable table format
 */
function logTable(title: string, data: unknown[]): void {
  if (data.length === 0) {
    console.log(`\n${title}: No entries found\n`);
    return;
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${title} (${data.length} entries)`);
  console.log('='.repeat(80));
  console.table(data);
  console.log('='.repeat(80));
}

async function main() {
  const fileParser = new FileParser();
  invariant(values.file, 'File argument is required');
  console.debug(`Parsing file ${values.file} with sheet ${values.sheet}`);
  const { valid, invalid } = await fileParser.parse(values.file, {
    schema: ColumnsSchema, xlsx: {
      sheetName: values.sheet || undefined,
    }
  });

  logTable('✅ VALID OCCURRENCES', valid);
  logTable('❌ INVALID OCCURRENCES', invalid);
}


try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
