import { DateTime } from 'luxon';

export type DisplayDate = `${string}/${string}/${string}`;

const DATE_FORMAT = 'dd/MM/yyyy';

export interface ServicePeriodInput {
  FECHA_SERVICIO_DESDE?: Date | null;
  FECHA_SERVICIO_HASTA?: Date | null;
  FECHA_VTO_PAGO?: Date | null;
}

export interface ResolvedServicePeriod {
  serviceFrom: DisplayDate;
  serviceTo: DisplayDate;
  paymentDue: DisplayDate;
  /** Human-readable notes about values that were corrected or defaulted. */
  warnings: string[];
}

/**
 * Resolves the service period + payment due dates that will be typed into the
 * AFIP form, applying the same fallbacks the pre-2026 issuer used when the CSV
 * values are missing or would be rejected by AFIP:
 *
 * - Missing dates default to the first/last day of the emission month.
 * - An inverted period (DESDE > HASTA) falls back to the emission month.
 * - A payment due date earlier than the emission date (always rejected by
 *   AFIP) falls back to the last day of the emission month.
 */
export function resolveServicePeriod(
  inv: ServicePeriodInput,
  emissionDate: DisplayDate,
): ResolvedServicePeriod {
  const warnings: string[] = [];

  let emission = DateTime.fromFormat(emissionDate, DATE_FORMAT);
  if (!emission.isValid) {
    emission = DateTime.now();
    warnings.push(
      `Fecha de emisión "${emissionDate}" inválida: se usa la fecha de hoy (${emission.toFormat(DATE_FORMAT)}) para derivar el período.`,
    );
  }

  const derivedFrom = emission.startOf('month');
  const derivedTo = emission.endOf('month').startOf('day');

  let from = inv.FECHA_SERVICIO_DESDE
    ? DateTime.fromJSDate(inv.FECHA_SERVICIO_DESDE).startOf('day')
    : derivedFrom;
  let to = inv.FECHA_SERVICIO_HASTA
    ? DateTime.fromJSDate(inv.FECHA_SERVICIO_HASTA).startOf('day')
    : derivedTo;

  if (from > to) {
    warnings.push(
      `Período de servicio inválido (desde ${from.toFormat(DATE_FORMAT)} > hasta ${to.toFormat(DATE_FORMAT)}): se usa el mes de la fecha de emisión (${derivedFrom.toFormat(DATE_FORMAT)} - ${derivedTo.toFormat(DATE_FORMAT)}).`,
    );
    from = derivedFrom;
    to = derivedTo;
  }

  let paymentDue = inv.FECHA_VTO_PAGO
    ? DateTime.fromJSDate(inv.FECHA_VTO_PAGO).startOf('day')
    : derivedTo;
  if (paymentDue < emission.startOf('day')) {
    warnings.push(
      `FECHA_VTO_PAGO (${paymentDue.toFormat(DATE_FORMAT)}) es anterior a la fecha de emisión (${emission.toFormat(DATE_FORMAT)}): AFIP la rechaza, se usa el último día del mes de emisión (${derivedTo.toFormat(DATE_FORMAT)}).`,
    );
    paymentDue = derivedTo;
  }

  return {
    serviceFrom: from.toFormat(DATE_FORMAT) as DisplayDate,
    serviceTo: to.toFormat(DATE_FORMAT) as DisplayDate,
    paymentDue: paymentDue.toFormat(DATE_FORMAT) as DisplayDate,
    warnings,
  };
}
