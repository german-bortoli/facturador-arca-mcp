---
name: openclaw-facturador-mcp
description: Calls the facturador MCP to validate and emit AFIP invoices when the user provides invoice data (CSV or Excel) plus AFIP credentials. Use when the user asks to issue invoices, run a dry-run, or process invoice files through MCP tools.
---

# OpenClaw Facturador MCP

## Purpose

Use this skill to process invoice input files and call the project MCP tools:

- `validate_credentials_source` for credential resolution check
- `dry_run_csv` for validation only
- `emit_invoice` for real emission

The MCP expects `invoiceCsvText` in the project legacy CSV format.

## Trigger Conditions

Apply this skill when the user:

- shares a CSV or XLSX invoice file
- shares AFIP credentials and asks to emit invoices
- asks to validate invoice rows before emission
- asks to run the facturador MCP flow end-to-end

## Required Inputs

Collect or confirm:

1. Invoice data source:
   - CSV text/file, or
   - Excel file (`.xlsx`)
2. Credentials:
   - `AFIP_USERNAME`
   - `AFIP_PASSWORD`
   - `AFIP_ISSUER_CUIT`
   - `RAZON_SOCIAL`
3. Run mode:
   - validation only (`dry_run_csv`), or
   - real emission (`emit_invoice`)

Optional run settings:

- `headless` (default `true`)
- `now`
- `retry`
- `pointOfSale`
- `debug`

## Workflow

Copy this checklist and execute in order:

```text
MCP Invoice Workflow
- [ ] Validate credentials source first
- [ ] Normalize invoice input into legacy CSV text
- [ ] Run dry_run_csv first
- [ ] If valid rows exist and user confirms, run emit_invoice
- [ ] Return structured result (success, failed, tracePath)
```

### 1) Validate credentials source

Call `validate_credentials_source` before processing invoices:

```json
{
  "credentials": {
    "AFIP_USERNAME": "<value>",
    "AFIP_PASSWORD": "<value>",
    "AFIP_ISSUER_CUIT": "<value>",
    "RAZON_SOCIAL": "<value>"
  },
  "allowInteractivePrompt": false
}
```

If validation fails, stop and ask the user to correct credentials.

Credential fallback mode:

- Preferred: explicit `credentials` object.
- Fallback: `credentialsCsvText` with optional `preferredIssuerCuit`.
- Last resort: `allowInteractivePrompt: true` only when an interactive session is available.

### 2) Normalize input to legacy CSV text

The MCP input field is always `invoiceCsvText`.

- If input is already CSV, use it directly.
- If input is XLSX, convert rows to CSV text using the legacy header contract:

`MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR`

### 3) Validate invoices first

Call `dry_run_csv` with:

```json
{
  "invoiceCsvText": "<legacy-csv-text>"
}
```

If `invalidCount > 0`, present invalid rows and stop unless user asks to continue.

### 4) Emit only after confirmation

Call `emit_invoice` with:

```json
{
  "invoiceCsvText": "<legacy-csv-text>",
  "credentials": {
    "AFIP_USERNAME": "<value>",
    "AFIP_PASSWORD": "<value>",
    "AFIP_ISSUER_CUIT": "<value>",
    "RAZON_SOCIAL": "<value>"
  },
  "headless": false,
  "now": true,
  "retry": false
}
```

### 5) Report result

Always report:

- `validCount` / `invalidCount`
- `successCount` / `failedCount`
- `failed` details (if any)
- `tracePath` (if present)

## Safety Rules

- Never print or persist raw credentials in summaries.
- Never store real credentials in docs, tests, or sample files.
- Treat CSV/XLSX content as sensitive and avoid copying personal data into logs.
- If AFIP rejects date (`Fecha del Comprobante inválida`), retry with current date (`now: true`) and a valid `FECHA`.

## Notes for AFIP Behavior

- For DNI flows, AFIP UI may force IVA receiver condition to Consumidor Final.
- For Monotributo/RI flows, prefer `TIPO_DOC=CUIT` and use `CONDICION_IVA_RECEPTOR` accordingly.
