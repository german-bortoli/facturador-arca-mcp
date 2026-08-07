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
  "pointsOfSale": ["00001", "00003"],
  "defaultPointOfSale": "00001"
}
```

Point-of-sale values must match the AFIP `<select>` option values exactly (e.g. `"00003"`, not `"3"`); the literal `"1"` means "first available option" (legacy).

### List stored clients

Call `list_clients` with no arguments. Returns masked credentials and POS data for all clients.

### Update a client (partial)

Only provide the fields you want to change. The client must already exist.

```json
{
  "AFIP_ISSUER_CUIT": "20999888776",
  "AFIP_PASSWORD": "new-password",
  "pointsOfSale": ["00001", "00003", "00005"]
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
| `COMPROBANTE` | Invoice type: `Factura C`, `Factura A`, `Factura B`. Determines the AFIP form flow (see Factura A section below). Credit/debit notes and receipts are NOT supported — the row is rejected. |
| `FECHA` | Emission date in `DD/MM/YYYY` format. Found as "Fecha de Emisión". |
| `CONCEPTO` | Description of the service or product. Usually the item description line. |
| `FORMA_DE_PAGO` | Payment condition (e.g. `Transferencia Bancaria`, `Contado`). |
| `TOTAL` | "Importe Total". Final amount for Factura B/C. For Factura A it is the NET amount (AFIP adds 21% IVA on top unless `IVA_EXENTO=true`). |
| `PAGADOR` | "Apellido y Nombre / Razón Social" of the receiver/client. Leave empty for a Consumidor Final sin identificar. |
| `TIPO_DOC` | Document type of the receiver. Use `CUIT` when a CUIT is shown. Use `DNI` only when only a DNI is shown. Leave empty (or use `CONSUMIDOR FINAL`) when the client is not identified. |
| `DOCUMENTO` | The CUIT or DNI number of the receiver. Leave empty for a Consumidor Final sin identificar (the row emits with DocTipo 99, DocNro 0). |
| `DIRECCION` | Receiver's address. Found as "Domicilio" in the receiver section. Optional for a Consumidor Final sin identificar. |
| `CONDICION_IVA_RECEPTOR` | IVA condition of the receiver. Accepts valid numeric codes or text labels (see table below). |
| `PERIODO_DESDE` | Optional for any comprobante. Service period start date in `DD/MM/YYYY`. Alias for `FECHA_SERVICIO_DESDE`. If omitted, auto-calculated from `FECHA`. For Factura C include it only when the service period differs from the emission month. |
| `PERIODO_HASTA` | Optional for any comprobante. Service period end date in `DD/MM/YYYY`. Alias for `FECHA_SERVICIO_HASTA`. If omitted, auto-calculated from `FECHA`. For Factura C include it only when the service period differs from the emission month. |
| `FECHA_VTO_PAGO` | Optional for any comprobante. Payment due date in `DD/MM/YYYY`. Must NOT be earlier than `FECHA` (AFIP rejects it; the issuer falls back to end of emission month with a warning). |
| `IVA_EXENTO` | Factura A/B only (IGNORED for Factura C). Set to `true` for IVA-exempt invoices. Accepts `true`/`si`/`sí`/`yes` or a percentage (e.g. `100`). Note: values older versions silently ignored (`sí` with accent, `100%`, `10,5`) now take effect, with a warning in `dry_run_csv`. |

Legacy fields (`MES`, `NRO_COMP`, `MATRICULA`, `HOSPEDAJE`, `SERVICIOS`, `RESIDENTE`) should be LEFT OUT of the CSV — do not extract them. `HOSPEDAJE` and `NRO_COMP` values are ignored entirely; the others only feed a fallback concept when `CONCEPTO` is empty.
`TOTAL` is the authoritative amount for invoice emission. Never duplicate it into `HOSPEDAJE`.
For Factura C (monotributo), `IVA_GRAVADO`/`IVA_EXENTO`/`ALICUOTA_IVA` are IGNORED: do not include them.

### Real examples extracted from reference invoices

**Factura C — Monotributo to Responsable Inscripto:**
```
FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
15/03/2026,Factura C,Desarrollo de software,Transferencia Bancaria,500,EMPRESA COPADA SRL,CUIT,30711111119,"Mitre 345, Rosario, Santa Fe",1
```

**Factura C — Monotributo to Responsable Monotributo:**
```
FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
15/03/2026,Factura C,Servicio de programacion de software,Transferencia Bancaria,200,PEREZ JUAN,CUIT,20999999990,"Belgrano 780, Córdoba, Córdoba",6
```

**Factura C — Monotributo to Consumidor Final sin identificar (no client data):**
```
FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
15/03/2026,Factura C,Venta de productos,Contado,25000,,,,,
```
No receiver data is needed: the invoice is emitted with DocTipo 99, DocNro 0 and receiver condition 5 (Consumidor Final). ARCA accepts this while the total stays under the current identification threshold; above it the portal rejects the row and the receiver must be identified.

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

- CUIT or DNI of the receiver (never guess). If the user says the sale is to an unidentified final consumer (no client data available), no receiver fields are needed: leave `PAGADOR`, `TIPO_DOC` and `DOCUMENTO` empty.
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
Note: `validate_credentials_source` does NOT contact AFIP — it only checks that the 4 credential values are present after merging sources. A wrong password still returns `ok:true`.

Credential resolution priority (same list as the Client Store section):

1. Explicit `credentials` object (highest priority).
2. `credentialsCsvText` with optional `preferredIssuerCuit` (row selector only).
3. Stored client via `issuerCuit` (SQLite).
4. Interactive prompt — CLI only, never available under MCP.

**WARNING**: Never set `allowInteractivePrompt` to `true` when running as an MCP server — it will break the stdio transport. Always provide `issuerCuit` or `credentials` explicitly.

### 2) Normalize input to legacy CSV text

The MCP input field is always `invoiceCsvText`.

- If input is already CSV, use it directly.
- If input is XLSX, convert rows to CSV text using the legacy header contract.
- If input is a PDF or image, extract fields using the mapping table above.

Header contract — Monotributo / Factura C (base):

`FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR`

Header contract — Responsable Inscripto / Factura A-B (extended):

`FECHA,COMPROBANTE,CONCEPTO,FORMA_DE_PAGO,TOTAL,PAGADOR,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR,PERIODO_DESDE,PERIODO_HASTA,FECHA_VTO_PAGO,IVA_EXENTO`

Legacy columns (`MES`, `NRO_COMP`, `MATRICULA`, `HOSPEDAJE`, `SERVICIOS`, `RESIDENTE`) are still accepted for old files, but should not be generated.

### 3) Validate invoices first

Call `dry_run_csv` with the same `now` value you plan to use in `emit_invoice` (so previewed dates match the real run):

```json
{
  "invoiceCsvText": "<legacy-csv-text>",
  "now": true
}
```

If `invalidCount > 0`, present invalid rows and stop unless user asks to continue.

Also review and surface to the user:

- `warnings` — values that will be defaulted, corrected or ignored (invalid dates, unrecognized IVA values, text labels being interpreted, ignored legacy columns).
- `mapperPreview` — per row, exactly what would be sent to AFIP: comprobante type, amounts (`ImpNeto`/`ImpIVA`/`ImpTotal`), receiver IVA condition (and whether it was explicit), and the effective service period / payment due dates. If a row has `mapperError`, it will fail during emission — fix it first.

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
- Unidentified receivers (empty `TIPO_DOC`/`DOCUMENTO`) always emit with condition 5 (Consumidor Final): the default is 5 and any explicit different value is overridden with a warning. ARCA requires identifying the receiver above the current consumidor final threshold; over it, the portal rejects the row.
- For Monotributo/RI flows, prefer `TIPO_DOC=CUIT` and use `CONDICION_IVA_RECEPTOR` accordingly.
- Factura C (monotributo) never discriminates IVA: `TOTAL` is the final amount and the IVA columns are ignored.
- If the CSV explicitly requests a receiver IVA condition that the AFIP form does not offer for that comprobante, the row fails with a clear error (it is never silently replaced). Implicit defaults fall back to the portal's first option with a warning.

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

Codes `2`, `3`, `11`, `12` and `14` fall inside 1-16 but are NOT valid receiver codes: they fall back to the default `6` with a warning. When the column is empty, the default is `6` (Responsable Monotributo).

## Login URL for Responsable Inscripto (`loginUrl`)

By default, the facturador logs in through the Monotributo portal (`system=admin_mono`).
For Responsable Inscripto taxpayers who don't use the Monotributo portal, pass `loginUrl` to use the direct "Comprobantes en línea" entry point:

```json
{
  "loginUrl": "https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel"
}
```

This skips the Monotributo portal navigation and goes directly to `fe.afip.gob.ar` after login.

**WARNING**: never pass the `system=rcel` URL for a monotributista issuing Factura C — the default Monotributo login is the correct one for them.
