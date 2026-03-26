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
- `loginUrl` (use `system=rcel` URL for Responsable Inscripto taxpayers)

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
| `COMPROBANTE` | Invoice type: `Factura C`, `Factura A`, `Factura B`. Determines the AFIP form flow (see Factura A section below). |
| `NRO_COMP` | "Punto de Venta: Comp. Nro" — format as `XXXXX-XXXXXXXXX` (e.g. `00002-00000115`). Leave blank if not available. |
| `FECHA` | Emission date in `DD/MM/YYYY` format. Found as "Fecha de Emisión". |
| `CONCEPTO` | Description of the service or product. Usually the item description line. |
| `SERVICIOS` | Legacy optional field. Keep empty by default unless the user explicitly provides/requests it. |
| `FORMA_DE_PAGO` | Payment condition (e.g. `Transferencia Bancaria`, `Contado`). |
| `TOTAL` | "Importe Total" — the grand total amount. For IVA-exempt Factura A, this equals the net amount. |
| `PAGADOR` | "Apellido y Nombre / Razón Social" of the receiver/client. |
| `TIPO_DOC` | Document type of the receiver. Use `CUIT` when a CUIT is shown. Use `DNI` only when only a DNI is shown. |
| `DOCUMENTO` | The CUIT or DNI number of the receiver. |
| `DIRECCION` | Receiver's address. Found as "Domicilio" in the receiver section. |
| `CONDICION_IVA_RECEPTOR` | IVA condition of the receiver. Accepts numeric codes or text labels (see table below). |
| `PERIODO_DESDE` | Service period start date in `DD/MM/YYYY`. Alias for `FECHA_SERVICIO_DESDE`. If omitted, auto-calculated from `FECHA`. |
| `PERIODO_HASTA` | Service period end date in `DD/MM/YYYY`. Alias for `FECHA_SERVICIO_HASTA`. If omitted, auto-calculated from `FECHA`. |
| `IVA_EXENTO` | Set to `true` for IVA-exempt invoices (Factura A). Accepts `true`/`si`/`yes` or a percentage (e.g. `100`). |

Fields not present in the document (e.g. `MATRICULA`, `HOSPEDAJE`, `SERVICIOS`, `RESIDENTE`) should be left empty.
`TOTAL` is the authoritative amount for invoice emission.

### Real examples extracted from reference invoices

**Factura C — Monotributo to Responsable Inscripto:**
```
MES,COMPROBANTE,FECHA,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
MARZO,Factura C,15/03/2026,Desarrollo de software,Transferencia Bancaria,500,EMPRESA COPADA SRL,CUIT,30711111119,"Mitre 345, Rosario, Santa Fe",1
```

**Factura C — Monotributo to Responsable Monotributo:**
```
MES,COMPROBANTE,FECHA,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
MARZO,Factura C,15/03/2026,Servicio de programacion de software,Transferencia Bancaria,200,PEREZ JUAN,CUIT,20999999990,"Belgrano 780, Córdoba, Córdoba",6
```

**Factura A — RI to RI (IVA exempt, with service period):**
```
FECHA,PERIODO_DESDE,PERIODO_HASTA,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,FORMA_DE_PAGO,COMPROBANTE,IVA_EXENTO
25/03/2026,01/02/2026,28/02/2026,Honorarios profesionales,100000,EMPRESA EJEMPLO SA,CUIT,30999888770,"Av. Corrientes 1234, CABA",IVA Responsable Inscripto,Transferencia Bancaria,Factura A,true
```

**Factura A — RI to RI (with 21% IVA):**
```
FECHA,PERIODO_DESDE,PERIODO_HASTA,CONCEPTO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,FORMA_DE_PAGO,COMPROBANTE
25/03/2026,01/02/2026,28/02/2026,Servicios de consultoría,100000,EMPRESA EJEMPLO SA,CUIT,30999888770,"Av. Corrientes 1234, CABA",IVA Responsable Inscripto,Transferencia Bancaria,Factura A
```
Note: without `IVA_EXENTO=true`, Factura A defaults to 21% IVA. The `TOTAL` in this case is the net amount; AFIP adds IVA on top.

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

`MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,PERIODO_DESDE,PERIODO_HASTA,IVA_EXENTO`

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

### Factura A specifics

Factura A is used between Responsable Inscripto (RI) taxpayers. Key differences from Factura C:

1. **Login URL**: RI taxpayers must use `loginUrl: "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"` to go directly to "Comprobantes en línea" instead of the Monotributo portal.
2. **No document type selector**: Factura A always uses CUIT. The form shows the CUIT input directly without a document type dropdown.
3. **IVA on line items**: Factura A shows an IVA type dropdown per line item. By default it's 21%. Pass `IVA_EXENTO=true` in the CSV to select "Exento" (total = net, no IVA added).
4. **Service period dates**: Use `PERIODO_DESDE` and `PERIODO_HASTA` (or `FECHA_SERVICIO_DESDE`/`FECHA_SERVICIO_HASTA`) to set the service period explicitly. If omitted, the period is auto-calculated from the invoice date.
5. **Payment method**: Factura A uses checkboxes for payment method instead of a dropdown (the code handles both automatically).

## IVA Receiver Condition Codes (`CONDICION_IVA_RECEPTOR`)

Accepted aliases for this header:

- `CONDICION_IVA_RECEPTOR` (recommended)
- `CONDICIONIVA`
- `IVA_RECEPTOR`
- `IVA_RECEIVER` (backward compatibility)

Both numeric codes and Spanish text labels are accepted:

| Code | Accepted text labels |
|---|---|
| `1` | `IVA Responsable Inscripto`, `Responsable Inscripto` |
| `4` | `IVA Sujeto Exento`, `Sujeto Exento` |
| `5` | `Consumidor Final` |
| `6` | `Responsable Monotributo`, `Monotributo` |
| `7` | `Sujeto No Categorizado` |
| `8` | `Proveedor Exterior` |
| `9` | `Cliente Exterior` |
| `10` | `IVA Liberado Ley 19640` |
| `13` | `Monotributista Social` |
| `15` | `IVA No Alcanzado` |
| `16` | `Monotributo Trabajador Independiente Promovido` |

Text labels are case-insensitive and accent-insensitive.

## Login URL for Responsable Inscripto (`loginUrl`)

By default, the facturador logs in through the Monotributo portal (`system=admin_mono`).
For Responsable Inscripto taxpayers who don't use the Monotributo portal, pass `loginUrl` to use the direct "Comprobantes en línea" entry point:

```json
{
  "loginUrl": "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"
}
```

This skips the Monotributo portal navigation and goes directly to `fe.afip.gob.ar` after login.
