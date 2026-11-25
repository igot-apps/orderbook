import { describe, expect, it } from 'vitest';
import { lineAmount, quantityForAmount } from './invoiceMath';

describe('invoice editor calculations', () => {
  it('updates the final amount when quantity changes', () => {
    expect(lineAmount('1.2', '40')).toBe('48.00');
  });

  it('derives quantity when the final amount changes', () => {
    expect(quantityForAmount('46', '40')).toBe('1.1500');
    expect(lineAmount(quantityForAmount('46', '40'), '40')).toBe('46.00');
  });

  it('uses the current unit price', () => {
    expect(lineAmount('1.2', '38')).toBe('45.60');
    expect(lineAmount('2.2', '48')).toBe('105.60');
    expect(quantityForAmount('105.60', '48')).toBe('2.2000');
  });
});
