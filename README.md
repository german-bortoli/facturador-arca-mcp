## AFIP facturador (Playwright + MCP)

This project automates AFIP invoice issuance with Playwright.

## Fork attribution

This repository is a fork of [lukasver/facturador](https://github.com/lukasver/facturador).

Special thanks to [@lukasver](https://github.com/lukasver) for creating and publishing the base project.
This fork was created to add more flexibility to the invoicing flow and to provide an MCP server interface for tool-based integrations (for example Cursor/OpenClaw clients).

It supports:

- **CLI mode** for local file-based runs.
- **MCP mode** for Cursor/OpenClaw clients over stdio.

## Install

```bash
npm install
npx playwright install
```

## CSV contracts

This repository uses two CSV contracts:

| Contract | Used by | Example file | Parser |
|---|---|---|---|
| Canonical schema | CLI (`npm run invoices`, `npm run dry-run`) | `assets/canonical-example.csv` | `file-parser/index.ts` + `types/file.ts` |
| Legacy schema | MCP tools (`emit_invoices_from_legacy_csv`, `dry_run_legacy_csv`) | `csv/example.csv` | `mcp/parsers/legacy-invoice-csv.ts` |

Canonical required columns:

```csv
NOMBRE,TIPO DOCUMENTO,NUMERO,CONCEPTO,TOTAL
```

Canonical optional columns:

- `DOMICILIO`, `COD`, `FECHA_EMISION`, `FACTURA_TIPO`
- `METODO_PAGO` (for example `Transferencia bancaria`, `Otros`)
- `IVA_GRAVADO`, `IVA_EXCEMPT`, `IVA_PERCENTAGE`, `IVA_RECEIVER`
- `FECHA_SERVICIO_DESDE`, `FECHA_SERVICIO_HASTA`, `FECHA_VTO_PAGO`

Date support notes:

- `FECHA_EMISION` in legacy CSV accepts `dd/MM/yyyy` or `yyyy-MM-dd`.
- Service/payment dates accept `dd/MM/yyyy` or `yyyy-MM-dd`.

## CLI usage

Required env vars:

```bash
AFIP_USERNAME=username
AFIP_PASSWORD=password
AFIP_ISSUER_CUIT=20123456789
RAZON_SOCIAL="PEPITO SRL"
FILE=filename.csv
```

Run invoices:

```bash
npm run invoices -- --file=./path/to/file.xlsx
```

Run in visual mode:

```bash
npm run invoices -- --file=./path/to/file.xlsx --headless=false
```

Dry run:

```bash
npm run dry-run -- --file=./path/to/file.xlsx
```

## MCP server usage

Start MCP server:

```bash
npm run mcp:server
```

Available tools:

- `emit_invoices_from_legacy_csv`
- `dry_run_legacy_csv`
- `validate_credentials_source`

### `emit_invoices_from_legacy_csv` inputs

Required:

- `invoiceCsvText`: raw legacy CSV text (example format in `csv/example.csv`).

Optional:

- `credentialsCsvText`
- `credentials` (`AFIP_USERNAME`, `AFIP_PASSWORD`, `AFIP_ISSUER_CUIT`, `RAZON_SOCIAL`)
- `allowInteractivePrompt`
- `preferredIssuerCuit`
- `headless` (defaults to true; accepts boolean or string values)
- `slowMoMs`, `retry`
- `pointOfSale`
- `saveSummaryPath`, `summaryFormat`, `summaryFailedOnly`
- `currency`, `globalConcept`, `addMonthToConcept`
- `now`, `debug`

Credential precedence:

1. explicit `credentials`
2. `credentialsCsvText`
3. interactive prompt fallback (if enabled and TTY available)

### Quick test payload (MCP)

Use this payload as a copy-paste starting point for `emit_invoices_from_legacy_csv`:

```json
{
  "invoiceCsvText": "MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR\nABRIL,Factura C,00001-00000001,12/03/2026,Servicio de programacion de software,,150,,Transferencia bancaria,150,Cliente Demo SA,servicio de programacion de software,DNI,30111222,\"Calle Falsa 123, Ciudad Demo, Provincia Demo\",5",
  "credentials": {
    "AFIP_USERNAME": "YOUR_USERNAME_OR_CUIT",
    "AFIP_PASSWORD": "YOUR_PASSWORD",
    "AFIP_ISSUER_CUIT": "YOUR_ISSUER_CUIT",
    "RAZON_SOCIAL": "YOUR_COMPANY_NAME"
  },
  "headless": false,
  "retry": false,
  "pointOfSale": "1",
  "debug": true
}
```

### Legacy invoice CSV format (MCP)

Example:

```csv
MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
ABRIL,Factura C,00001-00000001,12/03/2026,Servicio de programacion de software,,150,,Otros,150,Cliente Demo Uno,servicio de programacion de software,DNI,30111222,"Calle Falsa 123, Ciudad Demo, Provincia Demo",5
```

Notes:

- `Comprobante` is optional (`Factura A/B/C` or `A/B/C`).
- If `Comprobante` is missing/invalid, first available AFIP option is used.
- `CONCEPTO` is preferred if provided; otherwise a legacy fallback concept is built.
- `METODO_PAGO` is optional. If empty/missing, the flow selects `Otros` by default.

### Legacy CSV fields reference (`csv/example.csv`)

Headers are normalized case-insensitively and accent-insensitively. For example, `Tipo doc`, `TIPO DOC`, and `tipodoc` are treated as the same header.

| Header | Required | Supported values / format | Behavior |
|---|---|---|---|
| `PAGADOR` | Yes | Any non-empty string | Mapped to `NOMBRE` (receiver name). |
| `Tipo doc` | Yes | Commonly `DNI`, `CUIT`, `CUIL` (case-insensitive) | Mapped to `TIPO_DOCUMENTO`. Unknown values are treated as `CONSUMIDOR FINAL` in AFIP mapping. |
| `Documento` | Yes | Numeric string (with or without separators like `.` `,` `-` spaces) | Mapped to `NUMERO`; separators are removed before AFIP mapping. |
| `TOTAL` | Yes | Positive number (e.g. `150`, `150.50`, `150,50`, `$150`) | Parsed to numeric amount. Must be > 0. |
| `CONCEPTO` | No | Any string | If present, used as invoice description. |
| `COMPROBANTE` | No | `A`, `B`, `C`, `Factura A`, `Factura B`, `Factura C` | Mapped to `FACTURA_TIPO`; if missing/invalid, first AFIP option is selected. |
| `FECHA` | No | `dd/MM/yyyy` or `yyyy-MM-dd` | Mapped to `FECHA_EMISION`; if missing/invalid, app fallback date is used. |
| `DIRECCION` | No | Any string | Mapped to `DOMICILIO`. Required at runtime for some DNI flows. |
| `FORMA_DE_PAGO` | No | Any label (e.g. `Transferencia bancaria`, `Otros`) | Preferred Spanish header for payment method. Tries dynamic AFIP matching by text/value; falls back to `Otros`, then first available option. |
| `COD` | No | Any string | Mapped to optional item code in invoice detail. |
| `IVA_GRAVADO` | No | Number (percentage) | Defaults to `100` when omitted. |
| `IVA_EXENTO` | No | Number (percentage) | Preferred Spanish header. Defaults to `0` when omitted. |
| `ALICUOTA_IVA` | No | Number (e.g. `21`, `10.5`, `27`) | Preferred Spanish header. Defaults to `21` when omitted. |
| `CONDICION_IVA_RECEPTOR` | No | Integer code `1..16` | Preferred Spanish header. Maps to AFIP IVA receiver condition. Defaults to `6` when omitted/invalid. |
| `FECHA_SERVICIO_DESDE` | No | `dd/MM/yyyy` or `yyyy-MM-dd` | Optional service period start date. |
| `FECHA_SERVICIO_HASTA` | No | `dd/MM/yyyy` or `yyyy-MM-dd` | Optional service period end date. |
| `FECHA_VTO_PAGO` | No | `dd/MM/yyyy` or `yyyy-MM-dd` | Optional payment due date. |
| `MATRICULA` / `HOSPEDAJE` / `SERVICIOS` / `MES` / `RESIDENTE` | No | Legacy text/amount fields | Used only to build fallback concept when `CONCEPTO` is empty. |
| `NRO_COMP` | No | Any string | Accepted but currently not used by the parser mapping. |

Accepted aliases for payment method header:

- `FORMA_DE_PAGO` (recommended)
- `METODO_PAGO`
- `FORMA_PAGO` / `FORMAPAGO`
- `CONDICION_DE_VENTA` / `CONDICIONDEVENTA`

Parser-required headers (minimum to pass structural validation):

- `TOTAL`
- `PAGADOR`
- `TIPO_DOC` (for example `Tipo doc`)
- `DOCUMENTO`

Accepted aliases for IVA receiver condition header:

- `CONDICION_IVA_RECEPTOR` (recommended)
- `CONDICIONIVA`
- `IVA_RECEPTOR`
- `IVA_RECEIVER` (backward compatibility)

`CONDICION_IVA_RECEPTOR` supported codes:

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

Notes:

- In current UI automation, `DNI` flows force IVA condition `5` (Consumidor final).
- For `CUIT`/`CUIL`, `CONDICION_IVA_RECEPTOR` is respected (or falls back to `6` when missing/invalid).

## Verification

Run tests:

```bash
npm run test:run
```

Run type check:

```bash
npx tsc --noEmit
```

Regression checklist:

- Validate legacy CSV using `dry_run_legacy_csv` (including both date formats).
- Validate credential source resolution via `validate_credentials_source`.
- Emit one invoice and verify:
  - dynamic point-of-sale and comprobante selection
  - receiver address handling for DNI and CUIT/CUIL flows
  - PDF generated in `invoices/`
  - summary + metadata files written when `saveSummaryPath` is provided
