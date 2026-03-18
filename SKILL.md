---
name: openclaw-facturador-mcp
description: Calls the facturador MCP to validate and emit AFIP invoices when the user provides invoice data (CSV, Excel, PDF, screenshot, or bank receipt). Use when the user asks to issue invoices, run a dry-run, or process invoice files through MCP tools.
---

# OpenClaw Facturador MCP

## Purpose

Use this skill to process invoice input files and call the project MCP tools:

### Invoice tools
- `validate_credentials_source` for credential resolution check
- `dry_run_csv` for validation only
- `emit_invoice` for real emission

### Client store tools
- `store_client` to persist AFIP credentials and points of sale in local SQLite
- `list_clients` to list all stored clients (masked credentials)
- `update_client` to partially update a stored client
- `delete_client` to remove a stored client

The MCP expects `invoiceCsvText` in the project legacy CSV format.

## Trigger Conditions

Apply this skill when the user:

- shares a CSV or XLSX invoice file
- shares a PDF invoice or bank receipt (screenshot or attached file)
- shares a screenshot of a bank transfer, payment, or billing document
- shares AFIP credentials and asks to emit invoices
- asks to validate invoice rows before emission
- asks to run the facturador MCP flow end-to-end
- asks to store, list, update, or delete a client
- asks to save AFIP credentials for reuse

## Required Inputs

Collect or confirm:

1. Invoice data source (any of the following):
   - CSV text/file
   - Excel file (`.xlsx`)
   - PDF invoice (previous AFIP invoice used as reference)
   - Screenshot or image of a bank receipt, transfer, or billing document
2. Credentials (one of):
   - **Stored client**: pass `issuerCuit` to load credentials from SQLite (saved via `store_client`). Use `list_clients` to check available clients.
   - **Explicit**: `AFIP_USERNAME`, `AFIP_PASSWORD`, `AFIP_ISSUER_CUIT`, `RAZON_SOCIAL`
3. Run mode:
   - validation only (`dry_run_csv`), or
   - real emission (`emit_invoice`)

Optional run settings:

- `headless` (default `true`)
- `now`
- `retry`
- `pointOfSale` (auto-selected from stored client POS when omitted)
- `debug`

---

## Client Store

The client store persists AFIP credentials and points of sale in local SQLite (`client_store.db`). Passwords are encrypted with `CLIENT_STORE_SECRET_KEY`. Once stored, credentials can be loaded by `issuerCuit` across all credential-accepting tools.

### Store a new client

```json
{
  "AFIP_USERNAME": "20999888776",
  "AFIP_PASSWORD": "my-password",
  "AFIP_ISSUER_CUIT": "20999888776",
  "businessName": "My Company SRL",
  "pointsOfSale": ["1", "3"],
  "defaultPointOfSale": "1"
}
```

### List stored clients

Call `list_clients` with no arguments. Returns masked credentials and POS data for all clients.

### Update a client (partial)

Only provide the fields you want to change. The client must already exist.

```json
{
  "AFIP_ISSUER_CUIT": "20999888776",
  "AFIP_PASSWORD": "new-password",
  "pointsOfSale": ["1", "3", "5"]
}
```

### Delete a client

```json
{
  "AFIP_ISSUER_CUIT": "20999888776"
}
```

### Credential resolution priority

When `emit_invoice` or `validate_credentials_source` resolves credentials:

1. Explicit `credentials` object (highest priority)
2. `credentialsCsvText`
3. SQLite stored client (by `issuerCuit`)
4. Interactive prompt (if enabled, lowest priority)

### Using stored clients with emit_invoice

```json
{
  "invoiceCsvText": "<csv-text>",
  "issuerCuit": "20999888776",
  "now": true
}
```

When `pointOfSale` is omitted, the system auto-selects `defaultPointOfSale` or the first stored POS.

---

## Extracting invoice data from PDFs and screenshots

When the user provides a PDF or image instead of a CSV, extract the fields by reading the document visually and map them to the CSV contract below.

### CSV field mapping

| CSV field | Where to find it in the document |
|---|---|
| `MES` | Month name of the billing period (e.g. `MARZO`, `ABRIL`). If unclear, use the month of `FECHA`. |
| `COMPROBANTE` | Invoice type printed on the document: `Factura C`, `Factura A`, `Factura B`, etc. |
| `NRO_COMP` | "Punto de Venta: Comp. Nro" — format as `XXXXX-XXXXXXXXX` (e.g. `00002-00000115`). Leave blank if not available. |
| `FECHA` | Emission date in `DD/MM/YYYY` format. Found as "Fecha de Emisión". |
| `CONCEPTO` | Description of the service or product. Usually the item description line (e.g. `Desarrollo de software`, `Servicio de programacion de software`). |
| `SERVICIOS` | Legacy optional field. Keep empty by default unless the user explicitly provides/requests it. |
| `FORMA_DE_PAGO` | Payment condition printed as "Condición de venta" (e.g. `Transferencia Bancaria`, `Contado`). |
| `TOTAL` | "Importe Total" — the grand total amount. |
| `PAGADOR` | "Apellido y Nombre / Razón Social" of the receiver/client (e.g. `PEREZ JUAN`, `EMPRESA COPADA SRL`). |
| `TIPO_DOC` | Document type of the receiver. Use `CUIT` when a CUIT is shown. Use `DNI` only when only a DNI is shown. |
| `DOCUMENTO` | The CUIT or DNI number of the receiver. Found after "CUIT:" in the receiver section. |
| `DIRECCION` | Receiver's address. Found as "Domicilio" in the receiver section. |
| `CONDICION_IVA_RECEPTOR` | IVA condition of the receiver (see codes table below). Found as "Condición frente al IVA" in the receiver section. |

Fields not present in the document (e.g. `MATRICULA`, `HOSPEDAJE`, `SERVICIOS`, `RESIDENTE`) should be left empty.
`TOTAL` is the authoritative amount for invoice emission.

### Real examples extracted from reference invoices

**Empresa Copada SRL (Responsable Inscripto):**
```
MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
MARZO,Factura C,00001-00000001,15/03/2026,Desarrollo de software,500,Transferencia Bancaria,500,EMPRESA COPADA SRL,CUIT,30711111119,"Mitre 345, Rosario, Santa Fe",1
```

**Juan Perez (Responsable Monotributo):**
```
MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
MARZO,Factura C,00001-00000002,15/03/2026,Servicio de programacion de software,200,Transferencia Bancaria,200,PEREZ JUAN,CUIT,20999999990,"Belgrano 780, Córdoba, Córdoba",6
```

### When extracting from a bank receipt / screenshot

Bank receipts typically show less data than an AFIP invoice. Extract what's available and ask the user to confirm or fill in anything missing:

- **Receiver name** → `PAGADOR`
- **Transfer amount** → `TOTAL` only
- **Date** → `FECHA`
- **Concept/description** → `CONCEPTO`
- **CBU/account holder name** → may help identify `DOCUMENTO` / `TIPO_DOC`, but usually ask the user

Always ask the user for any field that cannot be confidently inferred from the document. Do not guess CUIT numbers — ask explicitly.
Do not duplicate the amount in `HOSPEDAJE` or `SERVICIOS` unless the user explicitly asks for those legacy fields.

### Ambiguity resolution — ask before proceeding

If any of these fields cannot be reliably extracted, stop and ask the user:

- CUIT or DNI of the receiver (never guess)
- `CONDICION_IVA_RECEPTOR` if not explicitly stated in the document
- `CONCEPTO` / `SERVICIOS` if the description is ambiguous
- `FORMA_DE_PAGO` if not shown

Present a summary of extracted fields and ask the user to confirm before running `dry_run_csv`.

---

## Workflow

**CRITICAL — Credential resolution before emit_invoice or validate_credentials_source:**

1. **ALWAYS** call `list_clients` first.
2. If the response contains clients → use the matching `issuerCuit` **exactly as returned by `list_clients`**. Ask the user which client/point of sale if ambiguous.
3. If no stored clients exist → ask the user for AFIP credentials (`AFIP_USERNAME`, `AFIP_PASSWORD`, `AFIP_ISSUER_CUIT`, `RAZON_SOCIAL`) and pass them as the `credentials` object.
4. **NEVER** call `emit_invoice` or `validate_credentials_source` without providing either `issuerCuit` or `credentials`.
5. **NEVER** set `allowInteractivePrompt` to `true`.

**WARNING — Do NOT confuse `issuerCuit` with `DOCUMENTO`:**
- `issuerCuit` = the CUIT of the business **issuing** the invoice (your AFIP login). Get it from `list_clients`.
- `DOCUMENTO` = the CUIT/DNI of the **receiver/client** being invoiced (appears in the CSV data).
- These are two different entities. Never use the receiver's CUIT as `issuerCuit`.

Execute these steps in order:

```text
MCP Invoice Workflow
- [ ] Call list_clients to check for stored clients
- [ ] Resolve credentials: use issuerCuit (stored) or ask the user for explicit credentials
- [ ] Extract or receive invoice data (CSV, XLSX, PDF, or image)
- [ ] Map extracted fields to legacy CSV format
- [ ] Ask user to confirm or fill in any missing fields
- [ ] Validate credentials source (with issuerCuit or credentials object)
- [ ] Run dry_run_csv to validate invoice data
- [ ] If valid rows exist and user confirms, run emit_invoice (with issuerCuit or credentials object)
- [ ] Return structured result (success, failed, tracePath)
- [ ] If issued[].downloadUrl is present, render download links
```

### 1) Validate credentials source

Call `validate_credentials_source` before processing invoices.

**With stored client:**
```json
{
  "issuerCuit": "20999888776"
}
```

**With explicit credentials:**
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

Credential resolution priority:

1. Explicit `credentials` object.
2. `credentialsCsvText` with optional `preferredIssuerCuit`.
3. Stored client via `issuerCuit`.

**WARNING**: Never set `allowInteractivePrompt` to `true` when running as an MCP server — it will break the stdio transport. Always provide `issuerCuit` or `credentials` explicitly.

### 2) Normalize input to legacy CSV text

The MCP input field is always `invoiceCsvText`.

- If input is already CSV, use it directly.
- If input is XLSX, convert rows to CSV text using the legacy header contract.
- If input is a PDF or image, extract fields using the mapping table above.

Full legacy header contract:

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

Call `emit_invoice`.

**With stored client:**
```json
{
  "invoiceCsvText": "<legacy-csv-text>",
  "issuerCuit": "20999888776",
  "headless": true,
  "now": true,
  "retry": false
}
```

**With explicit credentials:**
```json
{
  "invoiceCsvText": "<legacy-csv-text>",
  "credentials": {
    "AFIP_USERNAME": "<value>",
    "AFIP_PASSWORD": "<value>",
    "AFIP_ISSUER_CUIT": "<value>",
    "RAZON_SOCIAL": "<value>"
  },
  "headless": true,
  "now": true,
  "retry": false
}
```

Include `serverHost` if the HTTP file server is configured (see env vars), so the response includes `downloadUrl` per invoice:

```json
{
  "serverHost": "http://localhost"
}
```

### 5) Report result

Always report:

- `validCount` / `invalidCount`
- `successCount` / `failedCount`
- `failed` details (if any)
- `tracePath` (if present)
- `issued` list with download links (if `downloadUrl` is present)

#### Handling download URLs

When `emit_invoice` returns an `issued` array, each entry may contain a `downloadUrl`. If present, render each one as a clickable markdown link so the user can download the generated PDF directly:

```
✅ Factura emitida para **Juan Perez**
[Descargar factura](http://localhost:8876/public/invoices/factura-202603-juan-perez-1-3f9a.pdf)
```

If `downloadUrl` is absent (server not configured), still report `artifactPath` so the user knows where the file was saved locally.

## Safety Rules

- Never print or persist raw credentials in summaries.
- Never store real credentials in docs, tests, or sample files.
- Treat CSV/XLSX content as sensitive and avoid copying personal data into logs.
- If AFIP rejects date (`Fecha del Comprobante inválida`), retry with current date (`now: true`) and a valid `FECHA`.
- Never guess CUIT or DNI numbers — always ask the user to confirm.

## Notes for AFIP Behavior

- For DNI flows, AFIP UI may force IVA receiver condition to Consumidor Final.
- For Monotributo/RI flows, prefer `TIPO_DOC=CUIT` and use `CONDICION_IVA_RECEPTOR` accordingly.

## IVA Receiver Condition Codes (`CONDICION_IVA_RECEPTOR`)

Accepted aliases for this header:

- `CONDICION_IVA_RECEPTOR` (recommended)
- `CONDICIONIVA`
- `IVA_RECEPTOR`
- `IVA_RECEIVER` (backward compatibility)

Supported codes:

| Code | IVA condition label |
|---|---|
| `1` | Responsable inscripto |
| `4` | Sujeto exento |
| `5` | Consumidor final |
| `6` | Responsable monotributo |
| `7` | Sujeto no categorizado |
| `8` | Proveedor exterior |
| `9` | Cliente exterior |
| `10` | IVA liberado Ley 19640 |
| `13` | Monotributista social |
| `15` | IVA no alcanzado |
| `16` | Monotributo trabajador independiente promovido |
