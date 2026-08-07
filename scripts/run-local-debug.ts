/**
 * Runs the CLI issuer (app.ts) loading credentials from the local SQLite
 * client store, so you can watch the real Playwright flow without MCP.
 *
 * Usage:
 *   CLIENT_STORE_SECRET_KEY=... DEBUG=true npx tsx scripts/run-local-debug.ts <issuerCuit> [app.ts args...]
 *
 * Example (headed browser, nothing gets emitted thanks to DEBUG=true):
 *   CLIENT_STORE_SECRET_KEY=... DEBUG=true npx tsx scripts/run-local-debug.ts 20323015113 \
 *     -f csv/test-consumidor-final.csv --headless false --now
 *
 * Credentials are injected into the child process env and never printed.
 */
import { spawn } from 'node:child_process';
import { resolveCredentials } from '../mcp/credentials-resolver';

async function main(): Promise<void> {
  const [issuerCuit, ...appArgs] = process.argv.slice(2);
  if (!issuerCuit) {
    console.error('Uso: tsx scripts/run-local-debug.ts <issuerCuit> [args de app.ts...]');
    console.error('El CUIT tiene que existir en el client store local (ver list_clients).');
    process.exit(1);
  }

  const credentials = await resolveCredentials({
    issuerCuit,
    allowInteractivePrompt: false,
  });

  const pointOfSale =
    process.env.POINT_OF_SALE?.trim() ||
    credentials.storedDefaultPointOfSale ||
    credentials.storedPointsOfSale?.[0] ||
    '';

  console.log(
    `Lanzando app.ts como ${credentials.RAZON_SOCIAL} (CUIT ${issuerCuit}, POS ${pointOfSale || 'auto'}) ` +
    `${process.env.DEBUG === 'true' ? '[DEBUG: no se emite nada]' : '[EMISION REAL]'}`,
  );

  const child = spawn('npx', ['tsx', 'app.ts', ...appArgs], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AFIP_USERNAME: credentials.AFIP_USERNAME,
      AFIP_PASSWORD: credentials.AFIP_PASSWORD,
      AFIP_ISSUER_CUIT: credentials.AFIP_ISSUER_CUIT,
      RAZON_SOCIAL: credentials.RAZON_SOCIAL,
      POINT_OF_SALE: pointOfSale,
    },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
