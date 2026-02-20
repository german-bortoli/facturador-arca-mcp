## AFIP simple facturador

This is a simple app made with Playwright that issues invoices using structured data from a CSV or XLSX file. The data in this example is for a lodging business, but can be amended to fit any other business needs. `csv.ts` contains logic and `interfaces.ts` contains types for better DX.

## Instructions

1. Make sure you have the following env vars:

```
   AFIP_USERNAME=username
   AFIP_PASSWORD=password
   AFIP_ISSUER_CUIT=20123456789
   RAZON_SOCIAL="PEPITO SRL"
   FILE=filename.csv
```

2. You need to create a comma-delimited CSV file (or use an XLSX file) to feed the parser and amend it to fit your business needs.
3. Run `bun install` to install dependencies.
4. Run `bun run invoices` to issue all required invoices.
5. Alternatively run `bun run debug` to run Playwright in debug mode and monitor the whole process in headed mode.

### Dry-run (preview input file)

To validate and preview which rows will be treated as valid or invalid **without** launching the browser or issuing any invoices, run:

```bash
bun run dry-run -- --file=./path/to/your/file.xlsx
# or with a specific sheet:
bun run dry-run -- --file=./path/to/file.xlsx --sheet=Sheet1
```

This runs `file.ts`, which parses the file with the same schema as the main app and prints tables of valid and invalid occurrences. Use it for debugging and to confirm data before a real run.

### Retry failed invoices

If some invoices fail (e.g. timeout or network), you can retry only the failed ones once at the end by passing the `--retry` flag:

```bash
bun run invoices -- --file=./data.xlsx --retry
```

After the first pass, the script prints a summary of successful and failed invoices. If `--retry` is set, it then retries each failed invoice once and prints the summary again.

### Timeout and recovery

Each invoice is issued with a 60-second timeout. If the step takes longer (e.g. slow server), that invoice is recorded as failed and the script continues with the next one instead of stopping. At the end you get a summary of successes and failures; use `--retry` to re-attempt failures. Once the flow reaches the final submission step (point of no return), the timeout is disarmed so the server can finish without being interrupted.

## Notes

- `app.ts` is the CLI entry point; it delegates invoice issuance to the `InvoiceIssuer` class in `invoice-issuer.ts`.
- Playwright locators and actions for issuing a single invoice live in `invoice-issuer.ts`.
