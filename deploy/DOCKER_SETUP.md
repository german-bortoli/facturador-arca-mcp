# Local 24/7 deployment (Docker Compose + optional systemd)

## 1) Prepare environment variables

Use `.env` in the project root. Minimum required values:

```env
AFIP_USERNAME=...
AFIP_PASSWORD=...
AFIP_ISSUER_CUIT=...
RAZON_SOCIAL=...
INVOICE_SERVER_HOST=http://<your-server-ip-or-domain>
INVOICE_HTTP_SERVER_PORT=8876
INVOICE_MCP_SERVER_PORT=9000
```

Notes:
- `INVOICE_SERVER_HOST` should be reachable by your MCP client if you want `downloadUrl` links.
- Do not commit real credentials.

## 2) Start the stack

```bash
docker compose up -d --build
```

## 3) Check status and logs

```bash
docker compose ps
docker compose logs -f facturador-mcp
```

## 4) Endpoints

- MCP transport: `http://<host>:9000/mcp`
- Invoice file server: `http://<host>:8876/public/invoices/...`

## 5) Update after changes

```bash
docker compose pull
docker compose up -d --build
```

## 6) Optional boot persistence with systemd

1. Copy the unit:
   ```bash
   sudo cp deploy/systemd/facturador-mcp-compose.service /etc/systemd/system/
   ```
2. Edit `WorkingDirectory` in `/etc/systemd/system/facturador-mcp-compose.service` to your real path (for example `/Users/german/Projects/facturador` or `/opt/facturador`).
3. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now facturador-mcp-compose.service
   ```
4. Verify:
   ```bash
   systemctl status facturador-mcp-compose.service
   ```
