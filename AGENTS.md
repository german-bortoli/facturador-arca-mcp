# AGENTS.md

This file defines generic guidance for AI/code agents working in this repository.

## Project Overview

- Purpose: automate AFIP invoice issuance with Playwright and expose it through MCP tools.
- Single invoice data source of truth: `csv/example.csv` (legacy CSV contract).
- Main MCP tools:
  - `validate_credentials_source`
  - `dry_run_csv`
  - `emit_invoice`

## Recommended MCP Workflow

1. Validate credentials first with `validate_credentials_source`.
2. Validate invoice rows with `dry_run_csv`.
3. Emit invoices with `emit_invoice` only after validation is clean and user confirms.
4. Return structured results including success/failed counts and `tracePath` when available.

## CSV Contract Conventions

- Prefer Spanish-friendly headers in user-facing examples:
  - `FORMA_DE_PAGO`
  - `CONDICION_IVA_RECEPTOR`
  - `ALICUOTA_IVA`
  - `IVA_EXENTO`
- Keep backward compatibility aliases supported by parser logic.
- Maintain compatibility with both `.csv` and `.xlsx` CLI inputs when possible.

## AFIP Runtime Behavior Notes

- AFIP date validation can fail if invoice date is older than previously issued vouchers.
  - If needed, use current date behavior (`now: true`) and/or update `FECHA`.
- DNI flows may force IVA receiver condition to Consumidor Final in AFIP UI.
- For Monotributo/RI scenarios, `TIPO_DOC=CUIT` is typically the most reliable path.

## Security and Privacy

- Never commit real credentials, personal IDs, or real customer data.
- Use placeholders in docs/tests/examples.
- Avoid printing raw credential values in logs or summaries.
- Keep generated invoice PDFs and traces out of tracked files unless explicitly required.

## Documentation Standards

- Keep `README.md` always in formal Argentinian Spanish.
- Use technical, professional language in `README.md`.
- Avoid colloquial expressions (for example: "Che").
- Keep technical docs in English unless the user explicitly requests another language.
- Keep user-facing CSV field explanations explicit and actionable.
- Reflect MCP tool name changes immediately in documentation to avoid stale examples.

## Language Rules for Code

- Write all source code in English (`.ts`, `.tsx`, `.js`, `.jsx`, scripts, tests, identifiers, comments, and error messages).
- Keep API/tool payload keys and field names in English unless a compatibility requirement mandates otherwise.
- Allowed Spanish exceptions are only the ones explicitly defined in this repository conventions:
  - `README.md` (formal Argentinian Spanish).
  - User-facing CSV headers and examples where Spanish naming is required.

## Validation Before Claiming Completion

At minimum, run:

- `npm run test:run -- tests/mcp-parsers.test.ts tests/file-parser.test.ts`
- `npx tsc --noEmit`

If behavior changes affect runtime flow, also validate with an MCP dry run before emission.

## Git Commit Convention

- Use semantic commit messages (Conventional Commits style), for example:
  - `feat(mcp): add emit_invoice tool rename`
  - `fix(parser): support CONDICION_IVA_RECEPTOR alias`
  - `docs(readme): update MCP usage examples`
