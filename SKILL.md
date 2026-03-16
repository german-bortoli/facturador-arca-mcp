---
name: openclaw-facturador-mcp
description: Calls the facturador MCP to validate and emit AFIP invoices when the user provides invoice data (CSV, Excel, PDF, screenshot, or bank receipt). Use when the user asks to issue invoices, run a dry-run, or process invoice files through MCP tools.
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
- shares a PDF invoice or bank receipt (screenshot or attached file)
- shares a screenshot of a bank transfer, payment, or billing document
- shares AFIP credentials and asks to emit invoices
- asks to validate invoice rows before emission
- asks to run the facturador MCP flow end-to-end

## Required Inputs

Collect or confirm:

1. Invoice data source (any of the following):
   - CSV text/file
   - Excel file (`.xlsx`)
   - PDF invoice (previous AFIP invoice used as reference)
   - Screenshot or image of a bank receipt, transfer, or billing document
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
| `SERVICIOS` | Monetary amount of the service item. Usually the subtotal of the service line. |
| `FORMA_DE_PAGO` | Payment condition printed as "Condición de venta" (e.g. `Transferencia Bancaria`, `Contado`). |
| `TOTAL` | "Importe Total" — the grand total amount. |
| `PAGADOR` | "Apellido y Nombre / Razón Social" of the receiver/client (e.g. `PEREZ JUAN`, `EMPRESA COPADA SRL`). |
| `TIPO_DOC` | Document type of the receiver. Use `CUIT` when a CUIT is shown. Use `DNI` only when only a DNI is shown. |
| `DOCUMENTO` | The CUIT or DNI number of the receiver. Found after "CUIT:" in the receiver section. |
| `DIRECCION` | Receiver's address. Found as "Domicilio" in the receiver section. |
| `CONDICION_IVA_RECEPTOR` | IVA condition of the receiver (see codes table below). Found as "Condición frente al IVA" in the receiver section. |

Fields not present in the document (e.g. `MATRICULA`, `HOSPEDAJE`, `RESIDENTE`) should be left empty.

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
- **Transfer amount** → `TOTAL` (and `SERVICIOS` if it's a service)
- **Date** → `FECHA`
- **Concept/description** → `CONCEPTO`
- **CBU/account holder name** → may help identify `DOCUMENTO` / `TIPO_DOC`, but usually ask the user

Always ask the user for any field that cannot be confidently inferred from the document. Do not guess CUIT numbers — ask explicitly.

### Ambiguity resolution — ask before proceeding

If any of these fields cannot be reliably extracted, stop and ask the user:

- CUIT or DNI of the receiver (never guess)
- `CONDICION_IVA_RECEPTOR` if not explicitly stated in the document
- `CONCEPTO` / `SERVICIOS` if the description is ambiguous
- `FORMA_DE_PAGO` if not shown

Present a summary of extracted fields and ask the user to confirm before running `dry_run_csv`.

---

## Workflow

Copy this checklist and execute in order:

```text
MCP Invoice Workflow
- [ ] Extract or receive invoice data (CSV, XLSX, PDF, or image)
- [ ] Map extracted fields to legacy CSV format
- [ ] Ask user to confirm or fill in any missing fields
- [ ] Validate credentials source first
- [ ] Run dry_run_csv first
- [ ] If valid rows exist and user confirms, run emit_invoice
- [ ] Return structured result (success, failed, tracePath)
- [ ] If issued[].downloadUrl is present, render download links
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
