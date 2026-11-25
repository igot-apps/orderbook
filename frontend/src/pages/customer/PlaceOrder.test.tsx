import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlaceOrderPage } from './PlaceOrder';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { name: 'Ama Mensah' } }) }));

const product = {
  id: 'salmon', name: 'Salmon', category: 'Fish',
  variants: [{ id: 'salmon-kg', name: 'Standard', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '40.00' }],
};

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.startsWith('/products')) return [product] as never;
    if (path === '/orders' && options?.method === 'POST') return { id: 'order-1', orderNumber: 'OP-00001' } as never;
    throw new Error(`Unexpected API request: ${path}`);
  });
});

describe('customer shopping flow', () => {
  it('adds a money amount, adjusts it in the basket review, and places the order', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/customer/orders/new']}><PlaceOrderPage /></MemoryRouter>
      </QueryClientProvider>
    );

    await user.click(await screen.findByRole('button', { name: 'Choose variation for Salmon' }));
    await user.click(screen.getByRole('button', { name: /Standard.*Select/ }));
    const amount = screen.getByRole('spinbutton', { name: 'Amount I want (GH₵)' });
    await user.clear(amount);
    await user.type(amount, '48');
    await user.click(screen.getByRole('button', { name: 'Add to basket' }));

    await user.click(screen.getByRole('button', { name: 'Basket · 1' }));
    const basket = screen.getByRole('dialog', { name: 'Your basket' });
    expect(within(basket).getAllByText('GH₵48.00').length).toBeGreaterThan(0);
    expect(within(basket).getByText('Ama Mensah')).toBeInTheDocument();
    await user.click(within(basket).getByRole('button', { name: 'Adjust order' }));
    const editAmount = within(basket).getByRole('spinbutton', { name: 'Amount for Salmon' });
    await user.clear(editAmount);
    await user.type(editAmount, '50');
    await user.click(within(basket).getByRole('button', { name: 'Done editing' }));
    expect(within(basket).getAllByText('GH₵50.00').length).toBeGreaterThan(0);

    await user.click(within(basket).getByRole('button', { name: 'Place order' }));
    await waitFor(() => expect(screen.getByText('OP-00001')).toBeInTheDocument());
    const createCall = vi.mocked(api).mock.calls.find(([path, options]) => path === '/orders' && options?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body)).items).toEqual([expect.objectContaining({ variantId: 'salmon-kg', requestedAmount: '50' })]);
    expect(within(screen.getByRole('dialog', { name: 'Order placed!' })).getByText('OP-00001')).toBeInTheDocument();
  });
});
