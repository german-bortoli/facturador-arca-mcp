import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { lookup as mimeLookup } from 'mime-types';

const INVOICES_DIR = resolve(process.cwd(), 'invoices');
const PREFIX = '/public/invoices/';

let startedPort: number | null = null;

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' || !req.url?.startsWith(PREFIX)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const rawFilename = decodeURIComponent(req.url.slice(PREFIX.length));

  // Reject any path traversal attempts
  if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }

  const safeFilename = basename(rawFilename);
  const filePath = join(INVOICES_DIR, safeFilename);

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const mimeType = mimeLookup(safeFilename) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Disposition': `attachment; filename="${safeFilename}"`,
  });
  createReadStream(filePath).pipe(res);
}

/**
 * Starts the invoice HTTP file server on the given port.
 * Idempotent: calling this more than once with the same port is a no-op.
 */
export function startInvoiceHttpServer(port: number): void {
  if (startedPort === port) return;
  if (startedPort !== null) {
    console.error(`[invoice-http-server] Already running on port ${startedPort}, ignoring request for port ${port}`);
    return;
  }
  startedPort = port;
  const server = createServer(handleRequest);
  server.listen(port, () => {
    console.error(`[invoice-http-server] Listening on http://localhost:${port}${PREFIX}*`);
  });
  server.on('error', (err) => {
    console.error(`[invoice-http-server] Error:`, err);
  });
}
