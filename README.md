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

### Legacy invoice CSV format (MCP)

Example:

```csv
MES,Comprobante,N° Comp,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,METODO_PAGO,TOTAL,PAGADOR,RESIDENTE,Tipo doc,Documento,DIRECCION
ABRIL,Factura C,00001-00000001,12/03/2026,Servicio de programacion de software,,150,,Otros,150,Cliente Demo Uno,servicio de programacion de software,DNI,30111222,"Calle Falsa 123, Ciudad Demo, Provincia Demo"
```

Notes:

- `Comprobante` is optional (`Factura A/B/C` or `A/B/C`).
- If `Comprobante` is missing/invalid, first available AFIP option is used.
- `CONCEPTO` is preferred if provided; otherwise a legacy fallback concept is built.
- `METODO_PAGO` is optional. If empty/missing, the flow selects `Otros` by default.

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
