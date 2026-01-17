/**
 * Utility functions for date formatting
 */

/**
 * Convert date from AFIP format (yyyymmdd) to display format (dd/mm/yyyy)
 * @param afipDate - Date in AFIP format (yyyymmdd)
 * @returns Date in display format (dd/mm/yyyy)
 * @example
 * formatDateFromAfip("20231220") // "20/12/2023"
 */
export function formatDateFromAfip(afipDate: string | number): string {
  const dateStr = String(afipDate);
  if (dateStr.length !== 8) {
    throw new Error(`Invalid AFIP date format: ${dateStr}`);
  }

  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);

  return `${day}/${month}/${year}`;
}

/**
 * Convert date to AFIP format (yyyymmdd)
 * @param date - Date object or string in ISO format
 * @returns Date in AFIP format (yyyymmdd)
 * @example
 * formatDateToAfip(new Date()) // "20231220"
 */
export function formatDateToAfip(date: Date | string): number {
  let dateObj: Date;

  if (typeof date === 'string') {
    dateObj = new Date(date);
  } else {
    dateObj = date;
  }

  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid date');
  }

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');

  return parseInt(`${year}${month}${day}`, 10);
}

/**
 * Get current date in AFIP format (yyyymmdd)
 * @returns Current date in AFIP format
 */
export function getCurrentDateAfip(date = new Date()): number {
  return formatDateToAfip(date);
}

/**
 * Get current date in display format (dd/mm/yyyy)
 * @returns Current date in display format
 */
export function getCurrentDateDisplay(): string {
  const now = new Date();
  return formatDateFromAfip(formatDateToAfip(now).toString());
}
