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
import { storeClient, type StoreClientToolInput } from './tools/store-client';
import { listClients } from './tools/list-clients';
import { updateClient, type UpdateClientToolInput } from './tools/update-client';
import { deleteClient, type DeleteClientToolInput } from './tools/delete-client';
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
      'Issues AFIP invoices from legacy CSV text. ' +
      'Credentials: pass issuerCuit to use a stored client (saved via store_client), OR pass an explicit credentials object. ' +
      'Call list_clients first to check for stored clients.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceCsvText: {
          type: 'string',
          minLength: 1,
          description:
            'Raw invoice CSV text. ' +
            'Monotributo / Factura C base headers: FECHA, COMPROBANTE, CONCEPTO, FORMA_DE_PAGO, TOTAL, PAGADOR, TIPO_DOC, DOCUMENTO, DIRECCION, CONDICION_IVA_RECEPTOR. ' +
            'Responsable Inscripto / Factura A-B additionally accepts: IVA_EXENTO, ALICUOTA_IVA, IVA_GRAVADO, PERIODO_DESDE, PERIODO_HASTA, FECHA_VTO_PAGO. ' +
            'Minimum required headers: TOTAL. ' +
            'PAGADOR, TIPO_DOC and DOCUMENTO may be omitted or left empty to invoice a Consumidor Final sin identificar (DocTipo 99, DocNro 0, receiver condition 5); ARCA accepts this while the total stays under the identification threshold. ' +
            'IMPORTANT: the IVA_* columns are IGNORED for Factura C (monotributo) — do not add them there. ' +
            'TOTAL is the final amount for Factura B/C; for Factura A it is the NET amount (21% IVA is added on top unless IVA_EXENTO=true). ' +
            'Legacy columns MES, MATRICULA, RESIDENTE, SERVICIOS only feed the fallback CONCEPTO; HOSPEDAJE and NRO_COMP are accepted but their values are IGNORED — leave them empty. ' +
            'PERIODO_DESDE/PERIODO_HASTA/FECHA_VTO_PAGO apply to ANY comprobante (for Factura C include them only when the service period differs from the emission month). ' +
            'A missing or unrecognized COMPROBANTE is issued as Factura C (credit/debit notes and receipts are rejected per row). ' +
            'Aliases: METODO_PAGO/FORMA_PAGO/CONDICION_DE_VENTA (payment method), CONDICIONIVA/IVA_RECEPTOR/IVA_RECEIVER (receiver condition), NOMBRE=PAGADOR, NUMERO=DOCUMENTO, DOMICILIO=DIRECCION, FECHA_EMISION=FECHA, PERIODO_DESDE/HASTA=FECHA_SERVICIO_DESDE/HASTA (schema-canonical aliases apply only when the legacy column is absent).',
        },
        credentialsCsvText: {
          type: 'string',
          description: 'Optional credentials CSV text with AFIP_USERNAME, AFIP_PASSWORD, AFIP_ISSUER_CUIT, RAZON_SOCIAL.',
        },
        credentials: credentialsObjectSchema,
        issuerCuit: {
          type: 'string',
          minLength: 11,
          description:
            'PREFERRED: CUIT of the business ISSUING the invoice (NOT the receiver/client DOCUMENTO in the CSV). ' +
            'Get this value from the list_clients response. ' +
            'Loads credentials from local SQLite (saved via store_client). ' +
            'When provided, no explicit credentials needed. ' +
            'Point of sale is auto-selected from stored data when pointOfSale is omitted.',
        },
        allowInteractivePrompt: {
          type: 'boolean',
          description:
            'IGNORED by the MCP server (it never prompts; interactive credential prompts are CLI-only). ' +
            'Accepted for backward compatibility — leave unset.',
        },
        preferredIssuerCuit: {
          type: 'string',
          description:
            'ONLY applies when credentialsCsvText has multiple rows: picks the row matching this CUIT. ' +
            'It does NOT load stored clients — use issuerCuit for that.',
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
        allowUnidentifiedReceivers: {
          type: 'boolean',
          description:
            'Required (true) to emit a CSV that has NO receiver identification columns (TIPO_DOC/DOCUMENTO): ' +
            'every row is issued as Consumidor Final sin identificar (DocTipo 99, DocNro 0, condition 5). ' +
            'Without it the call returns early with a message instead of emitting. Confirm with the user first. ' +
            'Not needed when the columns exist, even if some rows leave them empty.',
        },
        pointOfSale: {
          type: 'string',
          description:
            'Optional AFIP point-of-sale. Must match EXACTLY the value of the AFIP <select> option ' +
            '(e.g. "00003", not "3") — check list_clients or the portal. ' +
            'Omit to auto-select (stored defaultPointOfSale, then first stored POS, then first portal option). ' +
            'Note: the literal value "1" is treated as "first available option" for legacy compatibility.',
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
          description:
            'ISO 4217 code (e.g. "ARS") used ONLY to format amounts in logs and the run summary. ' +
            'It does NOT change the invoice currency: invoices are always issued in Argentine pesos (PES).',
        },
        globalConcept: {
          type: 'string',
          description:
            'Optional text appended as a suffix to every row\'s CONCEPTO (rendered as "<CONCEPTO> - <text>"). ' +
            'It does not replace the per-row CONCEPTO.',
        },
        addMonthToConcept: {
          type: 'boolean',
          description: 'Append formatted month/year to concept text.',
        },
        now: {
          type: 'boolean',
          description:
            'Date rule for rows without FECHA. true = today. ' +
            'false (default) = today, EXCEPT when today is before the 14th of the month: then the last day of the PREVIOUS month is used ' +
            '(may be rejected by AFIP due to the 5/10-day date tolerance). Rows with a valid FECHA always use their own date.',
        },
        debug: {
          type: 'boolean',
          description: 'Keep issuer flow in debug mode (no final issue submission).',
        },
        loginUrl: {
          type: 'string',
          description:
            'AFIP login URL. Defaults to the Monotributo login — correct for Factura C. ' +
            'ONLY for Responsable Inscripto taxpayers (Factura A/B) use ' +
            '"https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel". ' +
            'Do NOT pass the rcel URL for a monotributista issuing Factura C.',
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
      'Validates and normalizes legacy CSV text without launching the browser or issuing invoices. ' +
      'Returns per-row warnings (defaulted/ignored values) and a mapperPreview with exactly what would be sent to AFIP: ' +
      'comprobante type, amounts (ImpNeto/ImpIVA/ImpTotal), receiver IVA condition, and effective service period / payment due dates. ' +
      'Effective dates follow the same `now` rule as emit_invoice — pass the same value you will use there. ' +
      'ALWAYS review warnings and mapperPreview with the user before calling emit_invoice.',
    inputSchema: {
      type: 'object',
      properties: {
        invoiceCsvText: {
          type: 'string',
          minLength: 1,
          description: 'Raw legacy invoice CSV text to validate and normalize.',
        },
        now: {
          type: 'boolean',
          description:
            'Pass the SAME value you will pass to emit_invoice so the previewed dates match. ' +
            'true = today. false (default) = today, except before the 14th of the month: last day of the previous month.',
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
      'Resolves and masks the AFIP credentials source WITHOUT contacting AFIP: it only checks that the 4 required ' +
      'values are present after merging sources (a wrong password still returns ok:true). ' +
      'Pass issuerCuit to resolve a stored client, OR pass an explicit credentials object. ' +
      'Call list_clients first to check for available stored clients.',
    inputSchema: {
      type: 'object',
      properties: {
        issuerCuit: {
          type: 'string',
          minLength: 11,
          description:
            'PREFERRED: CUIT of the business ISSUING the invoice (NOT the receiver/client DOCUMENTO in the CSV). ' +
            'Get this value from the list_clients response. ' +
            'Loads credentials from local SQLite (saved via store_client). ' +
            'When provided, no explicit credentials needed.',
        },
        credentialsCsvText: {
          type: 'string',
          description: 'Credentials CSV text source.',
        },
        credentials: credentialsObjectSchema,
        allowInteractivePrompt: {
          type: 'boolean',
          description:
            'IGNORED by the MCP server (it never prompts; interactive credential prompts are CLI-only). ' +
            'Accepted for backward compatibility — leave unset.',
        },
        preferredIssuerCuit: {
          type: 'string',
          description:
            'ONLY applies when credentialsCsvText has multiple rows: picks the row matching this CUIT. ' +
            'It does NOT load stored clients — use issuerCuit for that.',
        },
      },
      anyOf: [
        { required: ['credentialsCsvText'] },
        { required: ['credentials'] },
        { required: ['issuerCuit'] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'store_client',
    title: 'Store client',
    description:
      'Persists AFIP client credentials and point-of-sale data in local SQLite storage. ' +
      'Once stored, emit_invoice can load credentials by issuerCuit without re-sending them each time. ' +
      'Requires the CLIENT_STORE_SECRET_KEY env var for password encryption.',
    inputSchema: {
      type: 'object',
      properties: {
        AFIP_USERNAME: {
          type: 'string',
          minLength: 1,
          description: 'AFIP login username (usually CUIT).',
        },
        AFIP_PASSWORD: {
          type: 'string',
          minLength: 1,
          description: 'AFIP login password. Stored encrypted (reversible) in SQLite.',
        },
        AFIP_ISSUER_CUIT: {
          type: 'string',
          minLength: 11,
          description: 'Issuer CUIT. Used as unique key for the stored client.',
        },
        businessName: {
          type: 'string',
          minLength: 1,
          description: 'Company or taxpayer display name (maps to RAZON_SOCIAL at runtime).',
        },
        pointsOfSale: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description:
            'Array of available point-of-sale identifiers for this client. ' +
            'Each value must match the AFIP <select> option value EXACTLY (e.g. "00003", not "3"); ' +
            'the literal "1" is treated as "first available option" (legacy).',
        },
        defaultPointOfSale: {
          type: 'string',
          description:
            'Default POS to use when pointOfSale is omitted from emit_invoice. Must be one of pointsOfSale ' +
            'and match the AFIP <select> option value exactly (e.g. "00003", not "3").',
        },
      },
      required: ['AFIP_USERNAME', 'AFIP_PASSWORD', 'AFIP_ISSUER_CUIT', 'businessName', 'pointsOfSale'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_clients',
    title: 'List clients',
    description:
      'Returns all stored clients from local SQLite with masked credentials. No inputs required.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'update_client',
    title: 'Update client',
    description:
      'Partially updates a stored client. Only the provided fields are changed; ' +
      'omitted fields keep their current values. The client must already exist (use store_client to create).',
    inputSchema: {
      type: 'object',
      properties: {
        AFIP_ISSUER_CUIT: {
          type: 'string',
          minLength: 11,
          description: 'Issuer CUIT identifying the client to update.',
        },
        AFIP_USERNAME: {
          type: 'string',
          minLength: 1,
          description: 'New AFIP login username.',
        },
        AFIP_PASSWORD: {
          type: 'string',
          minLength: 1,
          description: 'New AFIP login password. Will be re-encrypted.',
        },
        businessName: {
          type: 'string',
          minLength: 1,
          description: 'New company or taxpayer display name.',
        },
        pointsOfSale: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'New array of point-of-sale identifiers.',
        },
        defaultPointOfSale: {
          type: ['string', 'null'],
          description: 'New default POS. Must be in pointsOfSale. Pass null to clear.',
        },
      },
      required: ['AFIP_ISSUER_CUIT'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_client',
    title: 'Delete client',
    description:
      'Permanently removes a stored client from local SQLite by issuer CUIT.',
    inputSchema: {
      type: 'object',
      properties: {
        AFIP_ISSUER_CUIT: {
          type: 'string',
          minLength: 11,
          description: 'Issuer CUIT of the client to delete.',
        },
      },
      required: ['AFIP_ISSUER_CUIT'],
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

### Invoice tools
1. **validate_credentials_source** — Verify AFIP credentials (supports \`issuerCuit\` for stored clients).
2. **dry_run_csv** — Validate CSV without touching AFIP.
3. **emit_invoice** — Issue invoices and get PDFs.

### Client store tools
4. **store_client** — Save AFIP credentials and points of sale to local SQLite.
5. **list_clients** — List all stored clients (masked credentials).
6. **update_client** — Partially update a stored client.
7. **delete_client** — Remove a stored client.

## Credentials

**Option A — explicit:** Pass \`AFIP_USERNAME\`, \`AFIP_PASSWORD\`, \`AFIP_ISSUER_CUIT\`, and \`RAZON_SOCIAL\` as a \`credentials\` object.

**Option B — stored client:** First call \`store_client\` once, then use \`issuerCuit\` in subsequent calls. No need to re-send credentials.

**IMPORTANT**: Before calling \`emit_invoice\` or \`validate_credentials_source\`, you MUST provide credentials:
- Call \`list_clients\` first. If a stored client matches, use its \`issuerCuit\` exactly as returned.
- If no stored client exists, ask the user for credentials and pass them as the \`credentials\` object.
- NEVER call \`emit_invoice\` without one of these. NEVER set \`allowInteractivePrompt\` to \`true\`.

**WARNING**: \`issuerCuit\` is the CUIT of the business ISSUING the invoice (from \`list_clients\`). Do NOT confuse it with \`DOCUMENTO\` in the CSV, which is the receiver/client being invoiced.

## Recommended flow (stored client)

1. \`list_clients\` — check for existing stored clients
2. \`store_client\` (once per client, if not already stored)
3. Build CSV (use the \`build_invoice_csv_from_input\` prompt)
4. \`dry_run_csv\` to validate
5. User confirms → \`emit_invoice\` with \`issuerCuit\`
6. Show \`downloadUrl\` links if present

## Recommended flow (explicit credentials)

1. \`list_clients\` — check if the client is already stored (prefer \`issuerCuit\` over explicit credentials)
2. \`validate_credentials_source\` with \`credentials\` object
3. Build CSV (use the \`build_invoice_csv_from_input\` prompt)
4. \`dry_run_csv\` to validate
5. User confirms → \`emit_invoice\` with \`credentials\` object
6. Show \`downloadUrl\` links if present

## IVA Receiver Condition

\`CONDICION_IVA_RECEPTOR\` accepts valid AFIP receiver codes (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16) or Spanish text labels (e.g. \`IVA Responsable Inscripto\`, \`Consumidor Final\`). Labels are case/accent-insensitive. Empty defaults to \`6\` (Responsable Monotributo) for identified receivers, and to \`5\` (Consumidor Final) for unidentified ones (no TIPO_DOC/DOCUMENTO). Unrecognized values fall back to the default and produce a warning in \`dry_run_csv\`.

Exceptions: \`TIPO_DOC=DNI\` and unidentified receivers always emit with condition \`5\` (Consumidor Final); any other value is overridden (with a warning when it was explicit).

## Consumidor Final sin identificar

A monotributista can invoice a final consumer without any client data: leave \`PAGADOR\`, \`TIPO_DOC\` and \`DOCUMENTO\` empty (or omit the columns). The invoice is emitted with DocTipo 99, DocNro 0 and receiver condition 5. \`DIRECCION\` is also optional in this case. ARCA accepts this while the total stays under the current identification threshold; above it the portal rejects the row and the receiver must be identified.

Safety gate: when the CSV has NO \`TIPO_DOC\`/\`DOCUMENTO\` columns at all, \`emit_invoice\` returns early without emitting unless you pass \`allowUnidentifiedReceivers: true\`. Run \`dry_run_csv\`, confirm with the user, then retry with the flag. A \`DOCUMENTO\` with an empty \`TIPO_DOC\` is a row error (specify CUIT/CUIL/DNI or clear the number).

Text labels are interpreted to their numeric code and produce one expected informational warning per row in \`dry_run_csv\` — this is normal, not an error; use the numeric code to avoid it.

## Monotributo (Factura C)

- The default \`loginUrl\` (Monotributo) is the correct one — do NOT pass the rcel URL.
- \`IVA_EXENTO\`, \`ALICUOTA_IVA\` and \`IVA_GRAVADO\` are IGNORED for Factura C: TOTAL is always the final amount.
- \`PERIODO_DESDE\`/\`PERIODO_HASTA\`/\`FECHA_VTO_PAGO\` work for any comprobante, but for Factura C add them only when the service period really differs from the emission month (auto-calculation from FECHA is correct otherwise).

## Factura A (Responsable Inscripto)

For RI taxpayers issuing Factura A:
- Pass \`loginUrl: "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"\` to skip the Monotributo portal.
- Use \`CONDICION_IVA_RECEPTOR=IVA Responsable Inscripto\` (or \`1\`).
- Set \`IVA_EXENTO=true\` in the CSV for IVA-exempt invoices. Without it, 21% IVA is added on top of TOTAL.
- Use \`PERIODO_DESDE\` and \`PERIODO_HASTA\` for explicit service period dates. If omitted, the period is auto-calculated from the invoice date.

Example CSV row (Factura A, IVA exempt):
\`\`\`
FECHA,PERIODO_DESDE,PERIODO_HASTA,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,FORMA_DE_PAGO,COMPROBANTE,IVA_EXENTO
25/03/2026,01/02/2026,28/02/2026,Honorarios profesionales,100000,EMPRESA SA,CUIT,30999888770,"Av. Corrientes 1234, CABA",IVA Responsable Inscripto,Transferencia Bancaria,Factura A,true
\`\`\`

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

## Step 1 — Identify the régimen

Ask (or infer from context) whether the ISSUER is a **Monotributista (Factura C)** or a **Responsable Inscripto (Factura A/B)**. The header depends on it.

## CSV header — Monotributo / Factura C (base)

\`\`\`
FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
\`\`\`

Do NOT add IVA columns for Factura C: \`IVA_EXENTO\`/\`ALICUOTA_IVA\`/\`IVA_GRAVADO\` are ignored there. Add \`PERIODO_DESDE\`/\`PERIODO_HASTA\` only when the service period differs from the emission month (it is auto-calculated from FECHA otherwise, which is correct for the common case).

## CSV header — Responsable Inscripto / Factura A-B (extended)

\`\`\`
FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,PERIODO_DESDE,PERIODO_HASTA,FECHA_VTO_PAGO,IVA_EXENTO
\`\`\`

## Checklist — confirm before proceeding

- [ ] COMPROBANTE (Factura A, B, or C — determines AFIP form flow and IVA handling). Credit/debit notes and receipts are NOT supported.
- [ ] PAGADOR (receiver name). Leave empty for a Consumidor Final sin identificar.
- [ ] DOCUMENTO (CUIT/DNI) — never guess, always confirm. Leave empty (with TIPO_DOC also empty) to invoice a Consumidor Final sin identificar: the row emits with DocTipo 99, DocNro 0 and condition 5.
- [ ] CONDICION_IVA_RECEPTOR (valid code 1/4/5/6/7/8/9/10/13/15/16 or text label, e.g. \`IVA Responsable Inscripto\`)
- [ ] TOTAL amount — final amount for Factura B/C; NET amount for Factura A (21% IVA added on top unless IVA_EXENTO=true)
- [ ] CONCEPTO description
- [ ] FORMA_DE_PAGO
- [ ] Optional (any type): PERIODO_DESDE / PERIODO_HASTA (DD/MM/YYYY) and FECHA_VTO_PAGO (must NOT be earlier than FECHA). For Factura C include them only when the service period differs from the emission month
- [ ] Factura A/B only: IVA_EXENTO — for Factura A, \`true\` means IVA-exempt (total = net, no IVA added); ignored for Factura C
- [ ] Leave legacy fields (\`MES\`, \`MATRICULA\`, \`HOSPEDAJE\`, \`SERVICIOS\`, \`RESIDENTE\`, \`NRO_COMP\`) OUT of the CSV unless explicitly provided by the user

## Factura A notes

For Factura A (RI to RI):
- Use \`CONDICION_IVA_RECEPTOR=IVA Responsable Inscripto\` (or code \`1\`)
- Set \`IVA_EXENTO=true\` if the service is IVA exempt. Without it, 21% IVA is added on top of TOTAL.
- Always include \`PERIODO_DESDE\` and \`PERIODO_HASTA\` explicitly — do not rely on auto-calculation.
- Pass \`loginUrl\` (rcel) in the emit_invoice call for RI taxpayers — never for monotributistas.

If any field cannot be reliably extracted, ask the user.
If \`PERIODO_HASTA\` is earlier than \`PERIODO_DESDE\`, or \`FECHA_VTO_PAGO\` is earlier than \`FECHA\`, stop and ask the user which date should be corrected.
Use \`TOTAL\` as the authoritative amount. Never duplicate the amount into \`HOSPEDAJE\` or \`SERVICIOS\`.
Once confirmed, pass the CSV to \`dry_run_csv\` and review its \`warnings\` and \`mapperPreview\` (amounts, receiver condition, dates) with the user.

Read the \`SKILL.md\` resource for the complete field mapping table, IVA condition codes, and Factura A examples.`,
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

**IMPORTANT**: Before calling \`emit_invoice\`, you MUST provide credentials:
- Call \`list_clients\` first. If a stored client matches, use its \`issuerCuit\` exactly as returned.
- If no stored client exists, ask the user for credentials and pass them as the \`credentials\` object.
- NEVER call \`emit_invoice\` without one of these. NEVER set \`allowInteractivePrompt\` to \`true\`.
- WARNING: \`issuerCuit\` is the CUIT of the business ISSUING the invoice (from \`list_clients\`). Do NOT confuse it with \`DOCUMENTO\` in the CSV (the receiver being invoiced).

0. **Check for stored client** — call \`list_clients\`. Use the \`issuerCuit\` value exactly as returned. Do NOT use the receiver's CUIT/DOCUMENTO from the invoice CSV.
1. **Validate credentials** — call \`validate_credentials_source\` with \`issuerCuit\` or \`credentials\` object. Stop if it fails.
2. **Build CSV** — use the \`build_invoice_csv_from_input\` prompt if needed.
3. **Dry run** — call \`dry_run_csv\`. Stop if \`invalidCount > 0\`. Review \`warnings\` (defaulted/ignored values) and \`mapperPreview\` (amounts, comprobante type, receiver IVA condition, effective dates) — surface anything unexpected to the user.
4. **Confirm** — present invoice count, totals, receiver names, and any dry-run warnings. **Do not proceed without user confirmation.**
5. **Emit** — call \`emit_invoice\` with \`now: true\` and \`issuerCuit\` (or \`credentials\` object). ONLY for Responsable Inscripto taxpayers (Factura A/B, never Monotributo/Factura C), add \`loginUrl: "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"\`.
6. **Report** — show success/failed counts and any per-invoice \`warnings\`. Render \`downloadUrl\` links if present.

Notes:
- \`CONDICION_IVA_RECEPTOR\` accepts valid AFIP receiver codes (1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16) or text labels (e.g. \`IVA Responsable Inscripto\`). Empty = 6 (Responsable Monotributo) for identified receivers, 5 (Consumidor Final) for unidentified ones. Text labels produce an expected informational warning in \`dry_run_csv\` (not a problem — confirm the interpreted code and continue). \`TIPO_DOC=DNI\` and unidentified receivers always emit with condition 5.
- Consumidor Final sin identificar: PAGADOR/TIPO_DOC/DOCUMENTO empty (or absent) is valid and emits DocTipo 99, DocNro 0, condition 5. The related dry-run warnings are informational, not errors. If the CSV has NO TIPO_DOC/DOCUMENTO columns at all, \`emit_invoice\` requires \`allowUnidentifiedReceivers: true\` (confirm with the user first). DOCUMENTO with an empty TIPO_DOC is a row error.
- Factura C (monotributo) ignores \`IVA_EXENTO\`/\`ALICUOTA_IVA\`/\`IVA_GRAVADO\`: TOTAL is always the final amount.
- For Factura A (RI to RI): set \`IVA_EXENTO=true\` in the CSV for exempt invoices. Use \`PERIODO_DESDE\`/\`PERIODO_HASTA\` for explicit service periods.
- Without \`IVA_EXENTO=true\`, Factura A defaults to 21% IVA added on top of TOTAL (TOTAL is the NET amount).
- Safety: never print raw credentials, never guess CUIT/DNI, retry with \`now: true\` if AFIP rejects the date, and never proceed when the service end date is earlier than the start date or \`FECHA_VTO_PAGO\` is earlier than \`FECHA\` (ask the user to correct first).

Read the \`SKILL.md\` resource for full payload examples, Factura A specifics, and AFIP behavior notes.`,
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
    if (name === 'store_client') {
      const result = storeClient(rawArgs as unknown as StoreClientToolInput);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (name === 'list_clients') {
      const result = listClients();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (name === 'update_client') {
      const result = updateClient(rawArgs as unknown as UpdateClientToolInput);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (name === 'delete_client') {
      const result = deleteClient(rawArgs as unknown as DeleteClientToolInput);
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
