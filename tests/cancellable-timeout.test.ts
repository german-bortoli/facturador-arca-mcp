import { describe, test, expect } from 'bun:test';
import { CancellableTimeout } from '../invoice-issuer';

describe('CancellableTimeout', () => {
  describe('timeout fires when not disarmed', () => {
    test('should reject when operation exceeds timeout and is not disarmed', async () => {
      const timeout = new CancellableTimeout(50, 'timed out');
      const slowOp = new Promise((resolve) => setTimeout(resolve, 200));

      await expect(Promise.race([slowOp, timeout.promise])).rejects.toThrow(
        'timed out',
      );
    });
  });

  describe('operation completes before timeout', () => {
    test('should resolve with operation result when it completes before timeout', async () => {
      const timeout = new CancellableTimeout(200, 'timed out');
      const fastOp = new Promise<string>((resolve) =>
        setTimeout(() => resolve('done'), 20),
      );

      const result = await Promise.race([fastOp, timeout.promise]);
      timeout.disarm();
      expect(result).toBe('done');
    });
  });

  describe('disarm at critical section', () => {
    test('should NOT reject when disarmed before timeout fires, even if operation is slower', async () => {
      const timeout = new CancellableTimeout(100, 'timed out');

      const operation = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        timeout.disarm(); // "point of no return" reached at 50ms
        await new Promise((resolve) => setTimeout(resolve, 150)); // total: 200ms > 100ms timeout
        return 'completed';
      })();

      const result = await Promise.race([operation, timeout.promise]);
      expect(result).toBe('completed');
    });
  });

  describe('operation throws', () => {
    test('should propagate operation error, not timeout error', async () => {
      const timeout = new CancellableTimeout(200, 'timed out');
      const failingOp = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('business error')), 20),
      );

      await expect(Promise.race([failingOp, timeout.promise])).rejects.toThrow(
        'business error',
      );
      timeout.disarm();
    });
  });

  describe('idempotent disarm', () => {
    test('should not throw when disarm is called multiple times', () => {
      const timeout = new CancellableTimeout(100, 'timed out');
      timeout.disarm();
      timeout.disarm();
      timeout.disarm();
      // no error thrown
    });
  });

  describe('disarm after timeout already fired', () => {
    test('should still reject if timeout fired; disarm afterwards is safe cleanup', async () => {
      const timeout = new CancellableTimeout(20, 'timed out');
      const slowOp = new Promise((resolve) => setTimeout(resolve, 200));

      await expect(Promise.race([slowOp, timeout.promise])).rejects.toThrow(
        'timed out',
      );
      timeout.disarm(); // cleanup -- should not throw
    });
  });
});
