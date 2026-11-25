import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreparedOrder } from './PreparedOrder';

const beef = { id: 'beef', productNameSnapshot: 'Beef', variantNameSnapshot: 'Stewing beef', requestedAmount: '24', estimatedQuantity: '0.5', catalogueUnitPrice: '48', unitSnapshot: 'KILOGRAM' };
const salmon = { ...beef, id: 'salmon', productNameSnapshot: 'Salmon', variantNameSnapshot: 'Standard', requestedAmount: '40', estimatedQuantity: '1', catalogueUnitPrice: '40' };
const order = { requestItems: [beef, salmon], estimatedTotal: '64', estimatedDeliveryCharge: '0' };
const preparedBeef = { ...beef, id: 'p-beef', requestItemId: beef.id, actualQuantity: '0.55', confirmedUnitPrice: '48', actualLineTotal: '26.40', priceChangeReason: 'The available cut weighs slightly more.' };
const preparedSalmon = { ...salmon, id: 'p-salmon', requestItemId: salmon.id, actualQuantity: '1', confirmedUnitPrice: '40', actualLineTotal: '40' };

describe('Prepared order comparison', () => {
  it('separates changed and unchanged items and explains the total increase', () => {
    render(<PreparedOrder order={order} revision={{ items: [preparedBeef, preparedSalmon], itemsTotal: '66.40', grandTotal: '66.40', deliveryCharge: '0' }} />);
    expect(screen.getByText('Changed:')).toBeInTheDocument();
    expect(screen.getByText('Salmon · Standard')).toBeInTheDocument();
    expect(screen.getByText(/The available cut weighs slightly more/)).toBeInTheDocument();
    expect(screen.getByText(/0.55 kg ×/)).toBeInTheDocument();
    expect(screen.getByText(/Increase:.*2.40/)).toBeInTheDocument();
  });
  it('clearly identifies a removal and the reduced total', () => {
    render(<PreparedOrder order={order} revision={{ items: [{ ...preparedBeef, isRemoved: true, actualLineTotal: '0', priceChangeReason: 'Out of stock' }, preparedSalmon], itemsTotal: '40', grandTotal: '40', deliveryCharge: '0' }} />);
    expect(screen.getByText('Removed:')).toBeInTheDocument();
    expect(screen.getByText(/Not included in your order/)).toBeInTheDocument();
    expect(screen.getByText(/Out of stock/)).toBeInTheDocument();
    expect(screen.getByText(/Decrease:.*24.00/)).toBeInTheDocument();
  });
});
