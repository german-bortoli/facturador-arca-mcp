import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type Prompt,
  type Resource,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dryRunCsv } from './tools/dry-run';
import { emitInvoice } from './tools/emit-invoices';
import { validateCredentialsSource } from './tools/validate-credentials';
import type {
  DryRunCsvInput,
  EmitInvoiceInput,
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
    name: 'emit_invoice',
    title: 'Emit invoice',
    description:
      'Issues AFIP invoices from legacy CSV text. Accepts optional credentials CSV text or explicit credentials fields.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceCsvText: {
          type: 'string',
          minLength: 1,
          description:
            'Raw invoice CSV text (csv/example.csv style). Recommended headers: MES, COMPROBANTE, NRO_COMP, FECHA, CONCEPTO, MATRICULA, HOSPEDAJE, SERVICIOS, FORMA_DE_PAGO, TOTAL, PAGADOR, RESIDENTE, TIPO_DOC, DOCUMENTO, DIRECCION, CONDICION_IVA_RECEPTOR. Minimum required headers: TOTAL, PAGADOR, TIPO_DOC, DOCUMENTO. Supported aliases include METODO_PAGO/FORMA_PAGO/CONDICION_DE_VENTA for payment method and CONDICIONIVA/IVA_RECEPTOR/IVA_RECEIVER for IVA receiver condition.',
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
        serverHost: {
          type: 'string',
          description:
            'Base URL of this server without port, e.g. "http://localhost". ' +
            'When provided (or set via INVOICE_SERVER_HOST env var), each successfully issued invoice ' +
            'will include a downloadUrl pointing to the embedded HTTP file server.',
        },
      },
      required: ['invoiceCsvText'],
      additionalProperties: false,
    },
  },
  {
    name: 'dry_run_csv',
    title: 'Dry run CSV',
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

const prompts: Prompt[] = [
  {
    name: 'facturador_onboarding',
    title: 'Facturador onboarding',
    description:
      'Explains how to use the facturador MCP server end-to-end: available tools, required inputs, environment variables, and connection modes.',
  },
  {
    name: 'build_invoice_csv_from_input',
    title: 'Build invoice CSV from input',
    description:
      'Guides you to build `invoiceCsvText` from unstructured input such as a PDF, screenshot, bank receipt, or notes. Returns a CSV draft and a checklist of missing fields to confirm.',
    arguments: [
      {
        name: 'inputDescription',
        description: 'Free-text description of the source document or data you want to convert into invoice CSV rows.',
        required: true,
      },
    ],
  },
  {
    name: 'run_safe_invoice_flow',
    title: 'Run safe invoice flow',
    description:
      'Step-by-step checklist to safely emit invoices: validate credentials, dry-run CSV, get user confirmation, then emit. Prevents accidental issuance.',
  },
];

const PROMPT_CONTENT: Record<string, (args?: Record<string, string>) => { description: string; messages: { role: 'user' | 'assistant'; content: { type: 'text'; text: string } }[] }> = {
  facturador_onboarding: () => ({
    description: 'How to use the facturador MCP server',
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `# Facturador MCP — Quick Start

## Tools

1. **validate_credentials_source** — Verify AFIP credentials.
2. **dry_run_csv** — Validate CSV without touching AFIP.
3. **emit_invoice** — Issue invoices and get PDFs.

## Credentials

Pass \`AFIP_USERNAME\`, \`AFIP_PASSWORD\`, \`AFIP_ISSUER_CUIT\`, and \`RAZON_SOCIAL\` as a \`credentials\` object.

## Recommended flow

1. \`validate_credentials_source\`
2. Build CSV (use the \`build_invoice_csv_from_input\` prompt)
3. \`dry_run_csv\` to validate
4. User confirms → \`emit_invoice\`
5. Show \`downloadUrl\` links if present

Read the \`SKILL.md\` resource for the full guide: field mapping, IVA codes, env vars, and AFIP behavior notes.`,
        },
      },
    ],
  }),

  build_invoice_csv_from_input: (args) => ({
    description: 'Build invoice CSV from unstructured input',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: args?.inputDescription ?? 'I have invoice data to convert to CSV.',
        },
      },
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `# Building invoiceCsvText

## CSV header

\`\`\`
MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
\`\`\`

## Checklist — confirm before proceeding

- [ ] PAGADOR (receiver name)
- [ ] DOCUMENTO (CUIT/DNI) — never guess, always confirm
- [ ] CONDICION_IVA_RECEPTOR code
- [ ] TOTAL amount
- [ ] CONCEPTO description
- [ ] FORMA_DE_PAGO
- [ ] FECHA_SERVICIO_DESDE <= FECHA_SERVICIO_HASTA (never allow end date before start date)
- [ ] Keep legacy optional fields (\`MATRICULA\`, \`HOSPEDAJE\`, \`SERVICIOS\`, \`RESIDENTE\`) empty unless explicitly provided by the user

If any field cannot be reliably extracted, ask the user.
If \`FECHA_SERVICIO_HASTA\` is earlier than \`FECHA_SERVICIO_DESDE\`, stop and ask the user which date should be corrected.
Use \`TOTAL\` as the authoritative amount. Do not duplicate the amount into \`HOSPEDAJE\` or \`SERVICIOS\` unless the user explicitly asks for those legacy fields.
Once confirmed, pass the CSV to \`dry_run_csv\`.

Read the \`SKILL.md\` resource for the complete field mapping table, IVA condition codes, and extraction examples from PDFs and screenshots.`,
        },
      },
    ],
  }),

  run_safe_invoice_flow: () => ({
    description: 'Safe invoice emission checklist',
    messages: [
      {
        role: 'assistant',
        content: {
          type: 'text',
          text: `# Safe Invoice Emission Flow

1. **Validate credentials** — call \`validate_credentials_source\`. Stop if it fails.
2. **Build CSV** — use the \`build_invoice_csv_from_input\` prompt if needed.
3. **Dry run** — call \`dry_run_csv\`. Stop if \`invalidCount > 0\`.
4. **Confirm** — present invoice count, totals, and receiver names. **Do not proceed without user confirmation.**
5. **Emit** — call \`emit_invoice\` with \`now: true\`.
6. **Report** — show success/failed counts. Render \`downloadUrl\` links if present.

Safety: never print raw credentials, never guess CUIT/DNI, retry with \`now: true\` if AFIP rejects the date, and never proceed when service end date is earlier than service start date (ask the user to correct first).

Read the \`SKILL.md\` resource for full payload examples and AFIP behavior notes.`,
        },
      },
    ],
  }),
};

function createMcpServer(): Server {
  const s = new Server(
    { name: 'facturador-mcp', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  s.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (name === 'emit_invoice') {
      const result = await emitInvoice(rawArgs as unknown as EmitInvoiceInput);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (name === 'dry_run_csv') {
      const result = dryRunCsv(rawArgs as unknown as DryRunCsvInput);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (name === 'validate_credentials_source') {
      const result = await validateCredentialsSource(rawArgs as unknown as ValidateCredentialsSourceInput);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }

    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  });

  s.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts }));

  s.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    const resolver = PROMPT_CONTENT[name];
    if (!resolver) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
    }
    return resolver(promptArgs);
  });

  const SKILL_URI = 'file:///SKILL.md';
  const resources: Resource[] = [
    {
      uri: SKILL_URI,
      name: 'SKILL.md',
      title: 'Facturador MCP Skill Guide',
      description:
        'Full workflow guide for using the facturador MCP: CSV field mapping, extraction from PDFs/screenshots, IVA condition codes, safe emission flow, and download URL handling.',
      mimeType: 'text/markdown',
    },
  ];

  s.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));

  s.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === SKILL_URI) {
      const skillPath = resolve(process.cwd(), 'SKILL.md');
      const text = await readFile(skillPath, 'utf-8');
      return {
        contents: [{ uri: SKILL_URI, mimeType: 'text/markdown', text }],
      };
    }
    throw new McpError(ErrorCode.MethodNotFound, `Unknown resource: ${uri}`);
  });

  return s;
}

async function startStreamableHttpTransport(port: number): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };

    const s = createMcpServer();
    await s.connect(transport);
    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
  }

  const httpServer = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/mcp' || url === '/') {
      handleMcp(req, res).catch((err) => {
        console.error('[mcp-http] Error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal server error');
        }
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, () => {
      console.error(`[mcp-http] Streamable HTTP transport listening on http://localhost:${port}/mcp`);
      resolve();
    });
    httpServer.on('error', reject);
  });
}

async function main() {
  const stdioServer = createMcpServer();
  const stdioTransport = new StdioServerTransport();
  await stdioServer.connect(stdioTransport);
  console.error('facturador-mcp server running (stdio)');

  const mcpPort = process.env.INVOICE_MCP_SERVER_PORT
    ? Number(process.env.INVOICE_MCP_SERVER_PORT)
    : undefined;

  if (mcpPort) {
    try {
      await startStreamableHttpTransport(mcpPort);
    } catch (err) {
      console.error(`[mcp-http] Failed to start HTTP transport on port ${mcpPort}:`, err);
      console.error('[mcp-http] Continuing with stdio transport only.');
    }
  }
}

main().catch((error) => {
  console.error('Failed to start MCP server', error);
  process.exit(1);
});
