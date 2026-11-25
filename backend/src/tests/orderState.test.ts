import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition } from '../lib/orderState';

describe('order status transitions', () => {
  it('allows valid happy-path transitions', () => {
    expect(canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransition('SUBMITTED', 'PREPARING')).toBe(true);
    expect(canTransition('PREPARING', 'AWAITING_CUSTOMER_APPROVAL')).toBe(true);
    expect(canTransition('AWAITING_CUSTOMER_APPROVAL', 'AGREED')).toBe(true);
    expect(canTransition('AGREED', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'COMPLETED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransition('DRAFT', 'AGREED')).toBe(false);
    expect(canTransition('COMPLETED', 'DISPATCHED')).toBe(false);
    expect(canTransition('CANCELLED', 'SUBMITTED')).toBe(false);
    expect(() => assertTransition('SUBMITTED', 'DELIVERED')).toThrow();
  });
});
