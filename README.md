## AFIP facturador (Playwright + MCP)

Este proyecto automatiza la emisión de facturas de AFIP con Playwright.

## Atribución del fork

Este repositorio es un fork de [lukasver/facturador](https://github.com/lukasver/facturador).

Agradecimiento especial a [@lukasver](https://github.com/lukasver) por crear y publicar el proyecto base.
Este fork se creó para agregar mayor flexibilidad al flujo de facturación y para ofrecer una interfaz de servidor MCP orientada a integraciones por herramientas (por ejemplo, clientes Cursor/OpenClaw).

Incluye:

- **Modo CLI** para ejecuciones locales basadas en archivo.
- **Modo MCP** para clientes Cursor/OpenClaw sobre stdio.

## Instalación

```bash
npm install
npx playwright install
```

## Referencia de Skill

Como referencia de operación OpenClaw + MCP en este proyecto, ver `SKILL.md`.

## Contratos CSV

Este repositorio utiliza un único contrato CSV para CLI y MCP:

| Contrato | Uso | Archivo de ejemplo | Parser |
|---|---|---|---|
| Esquema legacy (single source of truth) | CLI (`npm run invoices`, `npm run dry-run`) y MCP (`emit_invoice`, `dry_run_csv`) | `csv/example.csv` | `mcp/parsers/legacy-invoice-csv.ts` |

Notas sobre fechas:

- `FECHA_EMISION` en CSV legacy acepta `dd/MM/yyyy` o `yyyy-MM-dd`.
- Las fechas de servicio/pago aceptan `dd/MM/yyyy` o `yyyy-MM-dd`.

## Uso por CLI

Variables de entorno requeridas:

```bash
AFIP_USERNAME=username
AFIP_PASSWORD=password
AFIP_ISSUER_CUIT=20123456789
RAZON_SOCIAL="PEPITO SRL"
FILE=filename.csv
```

Ejecutar emisión de facturas:

```bash
npm run invoices -- --file=./path/to/file.xlsx
```

Ejecutar en modo visual:

```bash
npm run invoices -- --file=./path/to/file.xlsx --headless=false
```

Ejecución de validación (dry run):

```bash
npm run dry-run -- --file=./path/to/file.xlsx
```

## Uso del servidor MCP

Iniciar servidor MCP:

```bash
npm run mcp:server
```

Tools disponibles:

- `store_client` — Persiste credenciales AFIP y puntos de venta de un cliente en SQLite local (requiere `CLIENT_STORE_SECRET_KEY`).
- `list_clients` — Lista todos los clientes guardados (credenciales enmascaradas).
- `update_client` — Actualiza parcialmente un cliente existente (solo los campos enviados se modifican).
- `delete_client` — Elimina permanentemente un cliente del store local.
- `emit_invoice` — Emite facturas. Acepta `issuerCuit` para cargar credenciales desde el store local.
- `dry_run_csv` — Valida CSV sin emitir.
- `validate_credentials_source` — Verifica credenciales. Acepta `issuerCuit` para validar credenciales guardadas.

Prompts disponibles:

- `facturador_onboarding` — Explica cómo usar este servidor MCP de punta a punta: tools disponibles, inputs requeridos, variables de entorno y modos de conexión.
- `build_invoice_csv_from_input` — Guía para construir `invoiceCsvText` a partir de PDFs, screenshots, recibos bancarios o notas. Acepta un argumento `inputDescription` con la descripción del input. Devuelve un CSV borrador y un checklist de campos a confirmar.
- `run_safe_invoice_flow` — Checklist paso a paso para emitir facturas de forma segura: validar credenciales, dry-run, confirmar con el usuario, y luego emitir.

### Variables de entorno

| Variable | Ejemplo | Descripción |
|---|---|---|
| `INVOICE_SERVER_HOST` | `http://localhost` | URL base (sin puerto) para construir las URLs de descarga de PDFs. Cuando está configurada, `emit_invoice` incluye `downloadUrl` por cada factura emitida. |
| `INVOICE_HTTP_SERVER_PORT` | `8876` | Puerto del servidor HTTP embebido que sirve los PDFs generados bajo `/public/invoices/`. Por defecto `8876`. |
| `INVOICE_MCP_SERVER_PORT` | `9000` | Puerto del transporte HTTP/SSE del servidor MCP. Opcional: si no está configurado, el servidor corre únicamente por stdio. |
| `CLIENT_STORE_SECRET_KEY` | `mi-clave-secreta` | Clave secreta para encriptar contraseñas AFIP en el store SQLite local. Requerida al usar `store_client`. |

### Configuración en Claude Desktop

**Modo stdio — solo MCP, sin descarga de PDFs:**

Claude Desktop lanza el proceso directamente. No se carga ningún `.env`, por lo que las variables van en el campo `"env"` del config.

```json
{
  "mcpServers": {
    "facturador": {
      "command": "npx",
      "args": ["tsx", "/ruta/al/proyecto/mcp/server.ts"]
    }
  }
}
```

**Modo stdio — con servidor de descarga de PDFs:**

Agregar `INVOICE_SERVER_HOST` y `INVOICE_HTTP_SERVER_PORT` en `"env"`. El servidor HTTP arranca automáticamente dentro del mismo proceso y los links de descarga aparecen en la respuesta de `emit_invoice`.

```json
{
  "mcpServers": {
    "facturador": {
      "command": "npx",
      "args": ["tsx", "/ruta/al/proyecto/mcp/server.ts"],
      "env": {
        "INVOICE_SERVER_HOST": "http://localhost",
        "INVOICE_HTTP_SERVER_PORT": "8876"
      }
    }
  }
}
```

> `INVOICE_MCP_SERVER_PORT` no es necesario en modo stdio. Solo se usa para exponer el transporte HTTP/SSE adicional (ver modo HTTP más abajo).

**Modo HTTP/SSE** (conectar a un servidor ya en ejecución):

Iniciar el servidor manualmente con `INVOICE_MCP_SERVER_PORT` configurado (por `.env` o variable de entorno), y luego apuntar el cliente al endpoint HTTP:

```bash
INVOICE_SERVER_HOST=http://localhost \
INVOICE_HTTP_SERVER_PORT=8876 \
INVOICE_MCP_SERVER_PORT=9000 \
npx tsx mcp/server.ts
```

```json
{
  "mcpServers": {
    "facturador": {
      "type": "http",
      "url": "http://localhost:9000/mcp"
    }
  }
}
```

### Descarga de facturas generadas

Cuando `INVOICE_SERVER_HOST` está configurado (o se pasa `serverHost` como input al tool), la respuesta de `emit_invoice` incluye el campo `issued` con una `downloadUrl` por cada factura emitida exitosamente:

```json
{
  "successCount": 1,
  "issued": [
    {
      "name": "Juan Perez",
      "artifactPath": "invoices/factura-202603-juan-perez-1-3f9a.pdf",
      "downloadUrl": "http://localhost:8876/public/invoices/factura-202603-juan-perez-1-3f9a.pdf"
    }
  ]
}
```

El servidor HTTP que sirve los PDFs arranca automáticamente en el primer `emit_invoice` que tenga `serverHost` configurado.

### Inputs de `emit_invoice`

Requeridos:

- `invoiceCsvText`: texto CSV legacy crudo (formato de ejemplo en `csv/example.csv`).

Opcionales:

- `credentialsCsvText`
- `credentials` (`AFIP_USERNAME`, `AFIP_PASSWORD`, `AFIP_ISSUER_CUIT`, `RAZON_SOCIAL`)
- `issuerCuit` — Carga credenciales desde el store SQLite local (guardadas previamente con `store_client`). Si `pointOfSale` se omite, se usa automáticamente el primer punto de venta guardado del cliente.
- `allowInteractivePrompt`
- `preferredIssuerCuit`
- `headless` (por defecto `true`; acepta boolean o string)
- `slowMoMs`, `retry`
- `pointOfSale`
- `saveSummaryPath`, `summaryFormat`, `summaryFailedOnly`
- `currency`, `globalConcept`, `addMonthToConcept`
- `now`, `debug`
- `serverHost`: URL base del servidor (ej. `http://localhost`). Toma precedencia sobre `INVOICE_SERVER_HOST`.

Precedencia de credenciales:

1. `credentials` explícitas
2. `credentialsCsvText`
3. Store SQLite local (por `issuerCuit`)
4. Fallback interactivo por prompt (si está habilitado y hay TTY disponible)

### Payload rápido de prueba (MCP)

Usá este payload como punto de partida copy-paste para `emit_invoice`:

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

### Formato del CSV legacy de facturas (MCP)

Ejemplo:

```csv
MES,COMPROBANTE,NRO_COMP,FECHA,CONCEPTO,MATRICULA,HOSPEDAJE,SERVICIOS,FORMA_DE_PAGO,TOTAL,PAGADOR,RESIDENTE,TIPO_DOC,DOCUMENTO,DIRECCION,CONDICION_IVA_RECEPTOR
ABRIL,Factura C,00001-00000001,12/03/2026,Servicio de programacion de software,,150,,Otros,150,Cliente Demo Uno,servicio de programacion de software,DNI,30111222,"Calle Falsa 123, Ciudad Demo, Provincia Demo",5
```

Notas:

- `Comprobante` es opcional (`Factura A/B/C` o `A/B/C`).
- Si `Comprobante` falta o es inválido, se usa la primera opción disponible en AFIP.
- `CONCEPTO` tiene prioridad si está presente; si no, se construye un concepto legacy de respaldo.
- `FORMA_DE_PAGO`/`METODO_PAGO` es opcional. Si falta o está vacío, el flujo selecciona `Otros` por defecto.

### Referencia de campos del CSV legacy (`csv/example.csv`)

Los headers se normalizan sin distinguir mayúsculas/minúsculas ni acentos. Por ejemplo, `Tipo doc`, `TIPO DOC` y `tipodoc` se interpretan como el mismo header.

| Header | Requerido | Valores / formato soportado | Comportamiento |
|---|---|---|---|
| `PAGADOR` | Sí | Cualquier string no vacío | Se mapea a `NOMBRE` (nombre del receptor). |
| `Tipo doc` | Sí | Habitualmente `DNI`, `CUIT`, `CUIL` (sin distinguir mayúsculas/minúsculas) | Se mapea a `TIPO_DOCUMENTO`. Valores desconocidos se tratan como `CONSUMIDOR FINAL` en el mapeo AFIP. |
| `Documento` | Sí | String numérico (con o sin separadores como `.` `,` `-` espacios) | Se mapea a `NUMERO`; los separadores se eliminan antes del mapeo AFIP. |
| `TOTAL` | Sí | Número positivo (ej. `150`, `150.50`, `150,50`, `$150`) | Se parsea a monto numérico. Debe ser > 0. |
| `CONCEPTO` | No | Cualquier string | Si está presente, se usa como descripción de la factura. |
| `COMPROBANTE` | No | `A`, `B`, `C`, `Factura A`, `Factura B`, `Factura C` | Se mapea a `FACTURA_TIPO`; si falta o es inválido, se selecciona la primera opción AFIP. |
| `FECHA` | No | `dd/MM/yyyy` o `yyyy-MM-dd` | Se mapea a `FECHA_EMISION`; si falta o es inválida, se usa la fecha fallback de la app. |
| `DIRECCION` | No | Cualquier string | Se mapea a `DOMICILIO`. En ciertos flujos con DNI es obligatorio en runtime. |
| `FORMA_DE_PAGO` | No | Cualquier etiqueta (ej. `Transferencia bancaria`, `Otros`) | Método de pago. Intenta matching dinámico AFIP por texto/valor; fallback a `Otros` y luego a la primera opción disponible. |
| `COD` | No | Cualquier string | Se mapea a código opcional de ítem en el detalle. |
| `IVA_GRAVADO` | No | Número (porcentaje) | Por defecto `100` cuando se omite. |
| `IVA_EXENTO` | No | Número (porcentaje) | Por defecto `0` cuando se omite. |
| `ALICUOTA_IVA` | No | Número (ej. `21`, `10.5`, `27`) | Por defecto `21` cuando se omite. |
| `CONDICION_IVA_RECEPTOR` | No | Código entero `1..16` | Se mapea a condición IVA del receptor en AFIP. Por defecto `6` cuando falta o es inválido. |
| `FECHA_SERVICIO_DESDE` | No | `dd/MM/yyyy` o `yyyy-MM-dd` | Fecha opcional de inicio del período de servicio. |
| `FECHA_SERVICIO_HASTA` | No | `dd/MM/yyyy` o `yyyy-MM-dd` | Fecha opcional de fin del período de servicio. |
| `FECHA_VTO_PAGO` | No | `dd/MM/yyyy` o `yyyy-MM-dd` | Fecha opcional de vencimiento de pago. |
| `MATRICULA` / `HOSPEDAJE` / `SERVICIOS` / `MES` / `RESIDENTE` | No | Campos legacy de texto/monto | Se usan solo para construir el concepto de respaldo cuando `CONCEPTO` está vacío. |
| `NRO_COMP` | No | Cualquier string | Aceptado pero actualmente no se usa en el mapeo del parser. |

Aliases aceptados para el header de método de pago:

- `FORMA_DE_PAGO` (recomendado)
- `METODO_PAGO`
- `FORMA_PAGO` / `FORMAPAGO`
- `CONDICION_DE_VENTA` / `CONDICIONDEVENTA`

Headers requeridos por el parser (mínimos para validación estructural):

- `TOTAL`
- `PAGADOR`
- `TIPO_DOC` (por ejemplo `Tipo doc`)
- `DOCUMENTO`

Aliases aceptados para el header de condición IVA del receptor:

- `CONDICION_IVA_RECEPTOR` (recomendado)
- `CONDICIONIVA`
- `IVA_RECEPTOR`
- `IVA_RECEIVER` (compatibilidad hacia atrás)

Códigos soportados de `CONDICION_IVA_RECEPTOR`:

| Código | Etiqueta condición IVA |
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

Notas:

- En la automatización UI actual, los flujos con `DNI` fuerzan condición IVA `5` (Consumidor final).
- Para `CUIT`/`CUIL`, `CONDICION_IVA_RECEPTOR` se respeta (o hace fallback a `6` si falta o es inválido).

### Store de clientes (CRUD)

Los tools de gestión de clientes permiten guardar, listar, actualizar y eliminar credenciales AFIP y puntos de venta en una base de datos SQLite local (`client_store.db` en la raíz del proyecto). La contraseña se almacena con encriptación reversible usando `CLIENT_STORE_SECRET_KEY`.

**Crear cliente (`store_client`):**

```json
{
  "AFIP_USERNAME": "20999888776",
  "AFIP_PASSWORD": "mi-password",
  "AFIP_ISSUER_CUIT": "20999888776",
  "businessName": "Mi Empresa SRL",
  "pointsOfSale": ["1", "3", "5"],
  "defaultPointOfSale": "3"
}
```

**Listar clientes (`list_clients`):** sin parámetros requeridos. Devuelve todos los clientes con credenciales enmascaradas.

**Actualizar cliente (`update_client`):** solo se envían los campos a modificar. El cliente debe existir previamente.

```json
{
  "AFIP_ISSUER_CUIT": "20999888776",
  "AFIP_PASSWORD": "nueva-password",
  "pointsOfSale": ["1", "3", "5", "7"]
}
```

**Eliminar cliente (`delete_client`):**

```json
{
  "AFIP_ISSUER_CUIT": "20999888776"
}
```

Una vez guardado el cliente, se puede emitir una factura sin re-enviar credenciales:

```json
{
  "invoiceCsvText": "...",
  "issuerCuit": "20999888776",
  "headless": true
}
```

El sistema carga las credenciales desde SQLite y selecciona automáticamente el primer punto de venta guardado (o el `defaultPointOfSale` si fue configurado). Se puede pasar `pointOfSale` explícitamente para usar otro.

**Flujo recomendado:**

1. `store_client` (una vez por cliente, o al actualizar datos)
2. `dry_run_csv` (validar CSV)
3. `emit_invoice` con `issuerCuit` (emitir facturas usando credenciales guardadas)

## Verificación

Ejecutar tests:

```bash
npm run test:run
```

Ejecutar chequeo de tipos:

```bash
npx tsc --noEmit
```

Checklist de regresión:

- Validar CSV legacy con `dry_run_csv` (incluyendo ambos formatos de fecha).
- Validar resolución de credenciales con `validate_credentials_source`.
- Emitir una factura y verificar:
  - selección dinámica de punto de venta y comprobante
  - manejo de domicilio del receptor para flujos DNI y CUIT/CUIL
  - PDF generado en `invoices/`
  - archivos de summary + metadata escritos cuando se informa `saveSummaryPath`
