import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { dryRunLegacyCsv } from './tools/dry-run';
import { emitInvoicesFromLegacyCsv } from './tools/emit-invoices';
import { validateCredentialsSource } from './tools/validate-credentials';
import type {
  DryRunLegacyCsvInput,
  EmitInvoicesFromLegacyCsvInput,
  ValidateCredentialsSourceInput,
} from './types';

const credentialProperties = {
  AFIP_USERNAME: {
    type: 'string',
    minLength: 1,
    description: 'AFIP login username (usually CUIT).',
  },
  AFIP_PASSWORD: {
    type: 'string',
    minLength: 1,
    description: 'AFIP login password.',
  },
  AFIP_ISSUER_CUIT: {
    type: 'string',
    minLength: 11,
    description: 'Issuer CUIT used to select represented taxpayer.',
  },
  RAZON_SOCIAL: {
    type: 'string',
    minLength: 1,
    description: 'Tenant display name to select in AFIP facturador.',
  },
} as const;

const credentialsObjectSchema = {
  type: 'object',
  description: 'Explicit credentials. Takes precedence over CSV values when both are provided.',
  properties: credentialProperties,
  additionalProperties: false,
} as const;

const tools: Tool[] = [
  {
    name: 'emit_invoices_from_legacy_csv',
    title: 'Emit invoices from legacy CSV',
    description:
      'Issues AFIP invoices from legacy CSV text. Accepts optional credentials CSV text or explicit credentials fields.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceCsvText: {
          type: 'string',
          minLength: 1,
          description: 'Raw legacy invoice CSV text (csv/example.csv style).',
        },
        credentialsCsvText: {
          type: 'string',
          description: 'Optional credentials CSV text with AFIP_USERNAME, AFIP_PASSWORD, AFIP_ISSUER_CUIT, RAZON_SOCIAL.',
        },
        credentials: credentialsObjectSchema,
        allowInteractivePrompt: {
          type: 'boolean',
          description: 'When true, missing credential fields can be prompted from stdin in interactive sessions.',
        },
        preferredIssuerCuit: {
          type: 'string',
          description: 'If credentialsCsvText has multiple rows, pick the row matching this CUIT.',
        },
        headless: {
          type: ['boolean', 'string'],
          description: 'Browser mode. Defaults to true. Accepts true/false or string equivalents.',
        },
        slowMoMs: {
          type: 'number',
          minimum: 0,
          description: 'Optional Playwright slow motion delay in milliseconds.',
        },
        retry: {
          type: 'boolean',
          description: 'Retry failed invoices once at end of run.',
        },
        pointOfSale: {
          type: 'string',
          description: 'Optional AFIP point-of-sale value. Omit (or use "1") to pick first available option.',
        },
        saveSummaryPath: {
          type: 'string',
          description: 'Optional base path for generated run summary file.',
        },
        summaryFormat: {
          type: 'string',
          enum: ['csv', 'xlsx'],
          description: 'Summary file format when saveSummaryPath is set.',
        },
        summaryFailedOnly: {
          type: 'boolean',
          description: 'When true, summary includes only failed rows.',
        },
        currency: {
          type: 'string',
          description: 'Currency code used in run summary output.',
        },
        globalConcept: {
          type: 'string',
          description: 'Optional extra concept suffix text.',
        },
        addMonthToConcept: {
          type: 'boolean',
          description: 'Append formatted month/year to concept text.',
        },
        now: {
          type: 'boolean',
          description: 'Use current date instead of previous-month fallback date logic.',
        },
        debug: {
          type: 'boolean',
          description: 'Keep issuer flow in debug mode (no final issue submission).',
        },
      },
      required: ['invoiceCsvText'],
      additionalProperties: false,
    },
  },
  {
    name: 'dry_run_legacy_csv',
    title: 'Dry run legacy CSV',
    description:
      'Validates and normalizes legacy CSV text without launching the browser or issuing invoices.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceCsvText: {
          type: 'string',
          minLength: 1,
          description: 'Raw legacy invoice CSV text to validate and normalize.',
        },
      },
      required: ['invoiceCsvText'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_credentials_source',
    title: 'Validate credentials source',
    description:
      'Resolves credentials from explicit values, CSV input, or interactive fallback and returns a masked summary.',
    inputSchema: {
      type: 'object',
      properties: {
        credentialsCsvText: {
          type: 'string',
          description: 'Credentials CSV text source.',
        },
        credentials: credentialsObjectSchema,
        allowInteractivePrompt: {
          type: 'boolean',
          description: 'Allow stdin prompt to fill missing credential values.',
        },
        preferredIssuerCuit: {
          type: 'string',
          description: 'Preferred issuer CUIT when CSV has multiple rows.',
        },
      },
      oneOf: [
        { required: ['credentialsCsvText'] },
        { required: ['credentials'] },
        {
          required: ['allowInteractivePrompt'],
          properties: { allowInteractivePrompt: { const: true } },
        },
      ],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: 'facturador-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

  if (name === 'emit_invoices_from_legacy_csv') {
    const result = await emitInvoicesFromLegacyCsv(
      rawArgs as unknown as EmitInvoicesFromLegacyCsvInput,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  if (name === 'dry_run_legacy_csv') {
    const result = dryRunLegacyCsv(rawArgs as unknown as DryRunLegacyCsvInput);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  if (name === 'validate_credentials_source') {
    const result = await validateCredentialsSource(
      rawArgs as unknown as ValidateCredentialsSourceInput,
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('facturador-mcp server running');
}

main().catch((error) => {
  console.error('Failed to start MCP server', error);
  process.exit(1);
});
