import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = Decimal.Value;

export function D(value: MoneyInput = 0): Decimal {
  return new Decimal(value ?? 0);
}

export function money(value: MoneyInput): string {
  return D(value).toFixed(2);
}

export function qty(value: MoneyInput, places = 4): string {
  return D(value).toFixed(places);
}

/** estimated quantity = requested money / unit price */
export function estimatedQuantity(requestedAmount: MoneyInput, unitPrice: MoneyInput): Decimal {
  const price = D(unitPrice);
  if (price.lte(0)) return D(0);
  return D(requestedAmount).div(price);
}

/** actual line total = actual qty × confirmed unit price */
export function actualLineTotal(actualQuantity: MoneyInput, unitPrice: MoneyInput): Decimal {
  return D(actualQuantity).mul(D(unitPrice)).toDecimalPlaces(2);
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), D(0)).toDecimalPlaces(2);
}

export function difference(actual: MoneyInput, requested: MoneyInput): {
  amount: Decimal;
  percent: Decimal;
} {
  const a = D(actual);
  const r = D(requested);
  const amount = a.minus(r).toDecimalPlaces(2);
  const percent = r.eq(0) ? D(0) : amount.div(r).mul(100).toDecimalPlaces(2);
  return { amount, percent };
}

/**
 * Tolerance rule: max(absolute GH₵, percent of requested).
 * Returns true when difference exceeds tolerance (needs approval).
 */
export function exceedsTolerance(
  requestedTotal: MoneyInput,
  actualTotal: MoneyInput,
  toleranceAbs: MoneyInput,
  tolerancePct: MoneyInput
): boolean {
  const req = D(requestedTotal);
  const act = D(actualTotal);
  const diff = act.minus(req).abs();
  const pctThreshold = req.mul(D(tolerancePct).div(100));
  const threshold = Decimal.max(D(toleranceAbs), pctThreshold);
  return diff.gt(threshold);
}

export function formatGhs(value: MoneyInput): string {
  return `GH₵${D(value).toFixed(2)}`;
}

export { Decimal };
