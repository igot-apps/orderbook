import { describe, expect, it } from 'vitest';
import { ghs, statusLabel, unitLabel } from './format';

describe('format helpers', () => {
  it('formats Ghana cedi amounts', () => {
    expect(ghs(40)).toContain('40.00');
    expect(ghs('46.5')).toContain('46.50');
  });


  it('maps units and statuses', () => {
    expect(unitLabel('PACK')).toBe('pack');
    expect(statusLabel('AWAITING_CUSTOMER_APPROVAL')).toBe('Approval needed');
  });
});
