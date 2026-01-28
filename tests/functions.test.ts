import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getInvoiceDescription, getCurrentDefaultCode, getPeriodFromDate, getPeriodToDate } from '../functions';
import { DateTime } from 'luxon';

describe('getInvoiceDescription', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment variables before each test
    process.env.ADD_MONTH_TO_CONCEPT = 'true';
    process.env.GLOBAL_CONCEPT = undefined;
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = { ...originalEnv };
  });

  describe('month formatting', () => {
    const monthCases: Array<{ date: `${string}/${string}/${string}`, expected: string, month: string }> = [
      { date: '01/01/2026', expected: 'Test - ENE 2026', month: 'January' },
      { date: '15/02/2026', expected: 'Test - FEB 2026', month: 'February' },
      { date: '10/03/2026', expected: 'Test - MAR 2026', month: 'March' },
      { date: '20/04/2026', expected: 'Test - ABR 2026', month: 'April' },
      { date: '05/05/2026', expected: 'Test - MAY 2026', month: 'May' },
      { date: '30/06/2026', expected: 'Test - JUN 2026', month: 'June' },
      { date: '12/07/2026', expected: 'Test - JUL 2026', month: 'July' },
      { date: '25/08/2026', expected: 'Test - AGO 2026', month: 'August' },
      { date: '18/09/2026', expected: 'Test - SEPT 2026', month: 'September' },
      { date: '07/10/2026', expected: 'Test - OCT 2026', month: 'October' },
      { date: '22/11/2026', expected: 'Test - NOV 2026', month: 'November' },
      { date: '31/12/2026', expected: 'Test - DIC 2026', month: 'December' },
    ];

    monthCases.forEach(({ date, expected, month }) => {
      test(`should format ${month} correctly`, () => {
        expect(getInvoiceDescription('Test', date)).toBe(expected);
      });
    });
  });

  describe('Date object support', () => {
    test('should handle Date objects', () => {
      const date = new Date('2026-03-15');
      expect(getInvoiceDescription('Test', date)).toBe('Test - MAR 2026');
    });

    test('should handle Date objects for different months', () => {
      const date = new Date('2026-12-25');
      expect(getInvoiceDescription('Test', date)).toBe('Test - DIC 2026');
    });
  });

  describe('without ADD_MONTH_TO_CONCEPT', () => {
    test('should return only concept when ADD_MONTH_TO_CONCEPT is not set', () => {
      process.env.ADD_MONTH_TO_CONCEPT = undefined;
      expect(getInvoiceDescription('Test', '01/01/2026')).toBe('Test');
    });

    test('should return only concept when ADD_MONTH_TO_CONCEPT is false', () => {
      process.env.ADD_MONTH_TO_CONCEPT = 'false';
      expect(getInvoiceDescription('Test', '01/01/2026')).toBe('Test');
    });
  });

  describe('with GLOBAL_CONCEPT', () => {
    test('should use GLOBAL_CONCEPT when set', () => {
      process.env.GLOBAL_CONCEPT = 'Global Description';
      process.env.ADD_MONTH_TO_CONCEPT = undefined;
      expect(getInvoiceDescription('Test', '01/01/2026')).toBe('Test - Global Description');
    });

    test('should combine GLOBAL_CONCEPT with month when both are set', () => {
      process.env.GLOBAL_CONCEPT = 'Global Description';
      process.env.ADD_MONTH_TO_CONCEPT = 'true';
      expect(getInvoiceDescription('Test', '01/01/2026')).toBe('Test - Global Description - ENE 2026');
    });
  });

  describe('failing cases - invalid dates', () => {
    test('should throw error for invalid date format', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid date format
        getInvoiceDescription('Test', 'invalid-date');
      }).toThrow('Invalid date: invalid-date');
    });

    test('should throw error for malformed date string', () => {
      expect(() => {
        getInvoiceDescription('Test', '32/13/2026');
      }).toThrow();
    });

    test('should throw error for date with wrong format', () => {
      expect(() => {
        // @ts-expect-error - Testing wrong date format
        getInvoiceDescription('Test', '2026-01-01');
      }).toThrow();
    });

    test('should throw error for empty date string', () => {
      expect(() => {
        // @ts-expect-error - Testing empty date string
        getInvoiceDescription('Test', '');
      }).toThrow();
    });

    test('should throw error for date with invalid day', () => {
      expect(() => {
        getInvoiceDescription('Test', '32/01/2026');
      }).toThrow();
    });

    test('should throw error for date with invalid month', () => {
      expect(() => {
        getInvoiceDescription('Test', '01/13/2026');
      }).toThrow();
    });

    test('should throw error for date with invalid year format', () => {
      expect(() => {
        getInvoiceDescription('Test', '01/01/abc');
      }).toThrow();
    });
  });

  describe('edge cases', () => {
    test('should handle empty concept', () => {
      expect(getInvoiceDescription('', '01/01/2026')).toBe(' - ENE 2026');
    });

    test('should handle concept with special characters', () => {
      expect(getInvoiceDescription('Test & Co.', '01/01/2026')).toBe('Test & Co. - ENE 2026');
    });

    test('should handle leap year date', () => {
      expect(getInvoiceDescription('Test', '29/02/2024')).toBe('Test - FEB 2024');
    });

    test('should handle different years', () => {
      expect(getInvoiceDescription('Test', '01/01/2025')).toBe('Test - ENE 2025');
      expect(getInvoiceDescription('Test', '01/01/2027')).toBe('Test - ENE 2027');
    });

    test('should handle first day of month', () => {
      expect(getInvoiceDescription('Test', '01/06/2026')).toBe('Test - JUN 2026');
    });

    test('should handle last day of month', () => {
      expect(getInvoiceDescription('Test', '31/01/2026')).toBe('Test - ENE 2026');
    });
  });
});

describe('getCurrentDefaultCode', () => {
  describe('format validation', () => {
    test('should return code with at least 4 digits', () => {
      const code = getCurrentDefaultCode(1);
      expect(code.length).toBeGreaterThanOrEqual(4);
      expect(/^\d{4,}$/.test(code)).toBe(true);
    });

    test('should format index correctly with padding', () => {
      const code1 = getCurrentDefaultCode(1);
      const code12 = getCurrentDefaultCode(12);
      const code103 = getCurrentDefaultCode(103);

      // Index part should be padded to at least 2 digits
      expect(code1.length).toBeGreaterThanOrEqual(4);
      expect(code12.length).toBeGreaterThanOrEqual(4);
      expect(code103.length).toBeGreaterThanOrEqual(5); // 103 + 2 digits month = 5 digits

      // All should be numeric
      expect(/^\d+$/.test(code1)).toBe(true);
      expect(/^\d+$/.test(code12)).toBe(true);
      expect(/^\d+$/.test(code103)).toBe(true);
    });

    test('should use default index of 1 when not provided', () => {
      const code = getCurrentDefaultCode();
      expect(code.length).toBeGreaterThanOrEqual(4);
      expect(/^\d{4,}$/.test(code)).toBe(true);
    });
  });

  describe('month logic', () => {
    test('should include month as last 2 digits', () => {
      const code = getCurrentDefaultCode(1);
      const monthPart = code.slice(-2);

      // Month should be between 01 and 12
      const month = parseInt(monthPart, 10);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
      expect(monthPart.length).toBe(2);
    });

    test('should use current month when day >= 14', () => {
      // This test verifies the structure, actual month depends on test execution date
      const today = DateTime.now();
      const expectedMonth = today.day >= 14 ? today.month : today.minus({ days: today.day }).month;

      const code = getCurrentDefaultCode(1);
      const monthPart = code.slice(-2);
      const actualMonth = parseInt(monthPart, 10);

      expect(actualMonth).toBe(expectedMonth);
    });

    test('should use previous month when day < 14', () => {
      // This test verifies the structure, actual month depends on test execution date
      const today = DateTime.now();
      const expectedMonth = today.day < 14
        ? today.minus({ days: today.day }).month
        : today.month;

      const code = getCurrentDefaultCode(1);
      const monthPart = code.slice(-2);
      const actualMonth = parseInt(monthPart, 10);

      expect(actualMonth).toBe(expectedMonth);
    });
  });

  describe('edge cases', () => {
    test('should handle index 0', () => {
      const code = getCurrentDefaultCode(0);
      expect(code.length).toBeGreaterThanOrEqual(4);
      expect(/^\d{4,}$/.test(code)).toBe(true);
    });

    test('should handle large indices', () => {
      const code = getCurrentDefaultCode(9999);
      expect(code.length).toBeGreaterThanOrEqual(6); // 9999 + 2 digits month = 6 digits
      expect(/^\d+$/.test(code)).toBe(true);
    });

    test('should handle single digit indices', () => {
      const code = getCurrentDefaultCode(5);
      expect(code.length).toBeGreaterThanOrEqual(4);
      expect(/^\d{4,}$/.test(code)).toBe(true);
    });
  });
});

describe('getPeriodFromDate', () => {
  describe('basic functionality', () => {
    test('should return first day of month for mid-month date', () => {
      expect(getPeriodFromDate('15/03/2026')).toBe('01/03/2026');
    });

    test('should return first day when date is already first day', () => {
      expect(getPeriodFromDate('01/06/2026')).toBe('01/06/2026');
    });

    test('should return first day for last day of month', () => {
      expect(getPeriodFromDate('31/12/2026')).toBe('01/12/2026');
    });
  });

  describe('all months', () => {
    const monthCases: Array<{ date: `${string}/${string}/${string}`, expected: `${string}/${string}/${string}`, month: string }> = [
      { date: '15/01/2026', expected: '01/01/2026', month: 'January' },
      { date: '14/02/2026', expected: '01/02/2026', month: 'February' },
      { date: '20/03/2026', expected: '01/03/2026', month: 'March' },
      { date: '25/04/2026', expected: '01/04/2026', month: 'April' },
      { date: '10/05/2026', expected: '01/05/2026', month: 'May' },
      { date: '30/06/2026', expected: '01/06/2026', month: 'June' },
      { date: '15/07/2026', expected: '01/07/2026', month: 'July' },
      { date: '20/08/2026', expected: '01/08/2026', month: 'August' },
      { date: '10/09/2026', expected: '01/09/2026', month: 'September' },
      { date: '25/10/2026', expected: '01/10/2026', month: 'October' },
      { date: '15/11/2026', expected: '01/11/2026', month: 'November' },
      { date: '31/12/2026', expected: '01/12/2026', month: 'December' },
    ];

    monthCases.forEach(({ date, expected, month }) => {
      test(`should return first day for ${month}`, () => {
        expect(getPeriodFromDate(date)).toBe(expected);
      });
    });
  });

  describe('Date object support', () => {
    test('should handle Date objects', () => {
      const date = new Date(2026, 2, 15); // March 15, 2026 (month is 0-indexed)
      expect(getPeriodFromDate(date)).toBe('01/03/2026');
    });

    test('should handle Date objects for different months', () => {
      const date = new Date(2026, 11, 25); // December 25, 2026
      expect(getPeriodFromDate(date)).toBe('01/12/2026');
    });

    test('should handle Date objects for first day', () => {
      const date = new Date(2026, 5, 1); // June 1, 2026
      expect(getPeriodFromDate(date)).toBe('01/06/2026');
    });
  });

  describe('edge cases', () => {
    test('should handle leap year February', () => {
      expect(getPeriodFromDate('29/02/2024')).toBe('01/02/2024');
    });

    test('should handle non-leap year February', () => {
      expect(getPeriodFromDate('28/02/2023')).toBe('01/02/2023');
    });

    test('should handle year boundary', () => {
      expect(getPeriodFromDate('31/12/2023')).toBe('01/12/2023');
      expect(getPeriodFromDate('01/01/2026')).toBe('01/01/2026');
    });

    test('should handle different years', () => {
      expect(getPeriodFromDate('15/06/2023')).toBe('01/06/2023');
      expect(getPeriodFromDate('15/06/2025')).toBe('01/06/2025');
    });
  });

  describe('failing cases - invalid dates', () => {
    test('should throw error for invalid date format', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid date format
        getPeriodFromDate('invalid-date');
      }).toThrow('Invalid date: invalid-date');
    });

    test('should throw error for malformed date string', () => {
      expect(() => {
        getPeriodFromDate('32/13/2026');
      }).toThrow();
    });

    test('should throw error for date with wrong format', () => {
      expect(() => {
        // @ts-expect-error - Testing wrong date format
        getPeriodFromDate('2026-01-01');
      }).toThrow();
    });

    test('should throw error for date with invalid day', () => {
      expect(() => {
        getPeriodFromDate('32/01/2026');
      }).toThrow();
    });

    test('should throw error for date with invalid month', () => {
      expect(() => {
        getPeriodFromDate('01/13/2026');
      }).toThrow();
    });
  });
});

describe('getPeriodToDate', () => {
  describe('basic functionality', () => {
    test('should return last day of month for mid-month date', () => {
      expect(getPeriodToDate('15/03/2026')).toBe('31/03/2026');
    });

    test('should return last day when date is already last day', () => {
      expect(getPeriodToDate('31/03/2026')).toBe('31/03/2026');
    });

    test('should return last day for first day of month', () => {
      expect(getPeriodToDate('01/03/2026')).toBe('31/03/2026');
    });
  });

  describe('all months', () => {
    const monthCases: Array<{ date: `${string}/${string}/${string}`, expected: `${string}/${string}/${string}`, month: string }> = [
      { date: '15/01/2026', expected: '31/01/2026', month: 'January' },
      { date: '14/02/2024', expected: '29/02/2024', month: 'February (leap year)' },
      { date: '20/03/2026', expected: '31/03/2026', month: 'March' },
      { date: '25/04/2026', expected: '30/04/2026', month: 'April' },
      { date: '10/05/2026', expected: '31/05/2026', month: 'May' },
      { date: '30/06/2026', expected: '30/06/2026', month: 'June' },
      { date: '15/07/2026', expected: '31/07/2026', month: 'July' },
      { date: '20/08/2026', expected: '31/08/2026', month: 'August' },
      { date: '10/09/2026', expected: '30/09/2026', month: 'September' },
      { date: '25/10/2026', expected: '31/10/2026', month: 'October' },
      { date: '15/11/2026', expected: '30/11/2026', month: 'November' },
      { date: '31/12/2026', expected: '31/12/2026', month: 'December' },
    ];

    monthCases.forEach(({ date, expected, month }) => {
      test(`should return last day for ${month}`, () => {
        expect(getPeriodToDate(date)).toBe(expected);
      });
    });
  });

  describe('Date object support', () => {
    test('should handle Date objects', () => {
      const date = new Date(2026, 2, 15); // March 15, 2026 (month is 0-indexed)
      expect(getPeriodToDate(date)).toBe('31/03/2026');
    });

    test('should handle Date objects for different months', () => {
      const date = new Date(2026, 10, 15); // November 15, 2026
      expect(getPeriodToDate(date)).toBe('30/11/2026');
    });

    test('should handle Date objects for last day', () => {
      const date = new Date(2026, 2, 31); // March 31, 2026
      expect(getPeriodToDate(date)).toBe('31/03/2026');
    });
  });

  describe('edge cases - leap years', () => {
    test('should handle leap year February (29 days)', () => {
      expect(getPeriodToDate('15/02/2024')).toBe('29/02/2024');
      expect(getPeriodToDate('01/02/2024')).toBe('29/02/2024');
      expect(getPeriodToDate('29/02/2024')).toBe('29/02/2024');
    });

    test('should handle non-leap year February (28 days)', () => {
      expect(getPeriodToDate('15/02/2023')).toBe('28/02/2023');
      expect(getPeriodToDate('01/02/2023')).toBe('28/02/2023');
      expect(getPeriodToDate('28/02/2023')).toBe('28/02/2023');
    });

    test('should handle century years that are not leap years', () => {
      expect(getPeriodToDate('15/02/1900')).toBe('28/02/1900');
    });

    test('should handle century years that are leap years', () => {
      expect(getPeriodToDate('15/02/2000')).toBe('29/02/2000');
    });
  });

  describe('edge cases - months with different lengths', () => {
    test('should handle months with 31 days', () => {
      expect(getPeriodToDate('15/01/2026')).toBe('31/01/2026');
      expect(getPeriodToDate('15/03/2026')).toBe('31/03/2026');
      expect(getPeriodToDate('15/05/2026')).toBe('31/05/2026');
      expect(getPeriodToDate('15/07/2026')).toBe('31/07/2026');
      expect(getPeriodToDate('15/08/2026')).toBe('31/08/2026');
      expect(getPeriodToDate('15/10/2026')).toBe('31/10/2026');
      expect(getPeriodToDate('15/12/2026')).toBe('31/12/2026');
    });

    test('should handle months with 30 days', () => {
      expect(getPeriodToDate('15/04/2026')).toBe('30/04/2026');
      expect(getPeriodToDate('15/06/2026')).toBe('30/06/2026');
      expect(getPeriodToDate('15/09/2026')).toBe('30/09/2026');
      expect(getPeriodToDate('15/11/2026')).toBe('30/11/2026');
    });
  });

  describe('edge cases - year boundaries', () => {
    test('should handle year boundary', () => {
      expect(getPeriodToDate('31/12/2023')).toBe('31/12/2023');
      expect(getPeriodToDate('01/01/2026')).toBe('31/01/2026');
    });

    test('should handle different years', () => {
      expect(getPeriodToDate('15/06/2023')).toBe('30/06/2023');
      expect(getPeriodToDate('15/06/2025')).toBe('30/06/2025');
    });
  });

  describe('failing cases - invalid dates', () => {
    test('should throw error for invalid date format', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid date format
        getPeriodToDate('invalid-date');
      }).toThrow('Invalid date: invalid-date');
    });

    test('should throw error for malformed date string', () => {
      expect(() => {
        getPeriodToDate('32/13/2026');
      }).toThrow();
    });

    test('should throw error for date with wrong format', () => {
      expect(() => {
        // @ts-expect-error - Testing wrong date format
        getPeriodToDate('2026-01-01');
      }).toThrow();
    });

    test('should throw error for date with invalid day', () => {
      expect(() => {
        getPeriodToDate('32/01/2026');
      }).toThrow();
    });

    test('should throw error for date with invalid month', () => {
      expect(() => {
        getPeriodToDate('01/13/2026');
      }).toThrow();
    });
  });
});
