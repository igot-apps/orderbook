import { describe, expect, it } from 'vitest';
import {
  actualLineTotal,
  estimatedQuantity,
  exceedsTolerance,
  difference,
  money,
  D,
} from '../lib/money';

describe('money-safe calculations', () => {
  it('estimates quantity from money-first input', () => {
    expect(estimatedQuantity(40, 40).toFixed(4)).toBe('1.0000');
    expect(estimatedQuantity(60, 40).toFixed(4)).toBe('1.5000');
    expect(estimatedQuantity(40, 0).toFixed(4)).toBe('0.0000');
  });

  it('calculates actual prepared line total', () => {
    expect(actualLineTotal(1.15, 40).toFixed(2)).toBe('46.00');
    expect(money(actualLineTotal('2', '15'))).toBe('30.00');
  });

  it('computes difference amount and percent', () => {
    const d = difference(46, 40);
    expect(d.amount.toFixed(2)).toBe('6.00');
    expect(d.percent.toFixed(2)).toBe('15.00');
  });

  it('applies approval tolerance abs or percent (whichever greater)', () => {
    // requested 40, abs 2, pct 5% => threshold max(2, 2) = 2
    expect(exceedsTolerance(40, 46, 2, 5)).toBe(true);
    expect(exceedsTolerance(40, 41.5, 2, 5)).toBe(false);
    // large order: 1000, 5% = 50 > abs 2
    expect(exceedsTolerance(1000, 1040, 2, 5)).toBe(false);
    expect(exceedsTolerance(1000, 1060, 2, 5)).toBe(true);
  });

  it('does not use floating error for money sum style ops', () => {
    const total = D('0.1').plus('0.2');
    expect(total.toFixed(2)).toBe('0.30');
  });
});
