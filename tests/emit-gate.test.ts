import { describe, expect, test } from 'vitest';
import { emitInvoice } from '../mcp/tools/emit-invoices';

describe('emit_invoice — unidentified receivers gate', () => {
  test('CSV without TIPO_DOC/DOCUMENTO columns returns early without emitting', async () => {
    // The gate runs before credential resolution and browser launch, so this
    // is safe to call without credentials.
    const result = await emitInvoice({
      invoiceCsvText: ['CONCEPTO,TOTAL', 'Venta mostrador,1000'].join('\n'),
    });

    expect(result.validCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.failedCount).toBe(0);
    if (!('message' in result)) {
      throw new Error('expected the gated result variant (with message)');
    }
    expect(result.message).toContain('allowUnidentifiedReceivers');
    expect(result.message).toContain('No se emitió nada');
  });
});
