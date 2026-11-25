import { ProductVariations, variationSummary } from '../../components/ProductVariations';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ghs, unitLabel } from '../../lib/format';
import { useDebouncedValue, useSessionState } from '../../lib/hooks';
import { toast } from '../../lib/toast';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Icon,
  SuccessScreen,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  TextArea,
} from '../../components/ui';

type Product = {
  id: string;
  name: string;
  category: string;
  variants: Array<{
    id: string;
    name: string;
    brand?: string;
    unit: string;
    pricingType: string;
    unitPrice: string;
  }>;
};

type CartItem = {
  key: string;
  productId?: string;
  variantId?: string;
  isCustom?: boolean;
  customName?: string;
  customUnit?: string;
  label: string;
  unit: string;
  unitPrice: number;
  pricingType: string;
  requestedAmount: string;
  note: string;
};

const QUICK_AMOUNTS = [20, 40, 50, 100];

type Draft = { cart: CartItem[]; deliveryInstructions: string; deliveryCharge: string; updatedAt: number };
const EMPTY_DRAFT: Draft = { cart: [], deliveryInstructions: '', deliveryCharge: '0', updatedAt: 0 };
type Setter<T> = (value: T | ((previous: T) => T)) => void;

function readDrafts(key: string): Record<string, Draft> {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as Record<string, Draft>;
  } catch {
    return {};
  }
}

/** Seller drafts: one unfinished basket per customer, kept on this device until created or discarded. */
function useSellerDrafts(userId?: string) {
  const key = userId ? `op-seller-drafts:${userId}` : '';
  const [all, setAll] = useState<Record<string, Draft>>(() => readDrafts(key));
  useEffect(() => setAll(readDrafts(key)), [key]);

  const update = (customerId: string, change: (draft: Draft) => Draft) => {
    if (!key || !customerId) return;
    setAll((previous) => {
      const next = { ...previous };
      const changed = change(previous[customerId] || EMPTY_DRAFT);
      if (changed.cart.length === 0 && !changed.deliveryInstructions) delete next[customerId];
      else next[customerId] = { ...changed, updatedAt: Date.now() };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch { /* storage full or unavailable */ }
      return next;
    });
  };
  const field = <K extends 'cart' | 'deliveryInstructions' | 'deliveryCharge'>(customerId: string, name: K): Setter<Draft[K]> =>
    (value) => update(customerId, (draft) => ({
      ...draft,
      [name]: typeof value === 'function' ? (value as (previous: Draft[K]) => Draft[K])(draft[name]) : value,
    }));
  return {
    all,
    get: (customerId: string) => all[customerId] || EMPTY_DRAFT,
    field,
    remove: (customerId: string) => update(customerId, () => EMPTY_DRAFT),
  };
}

type Mode = 'customer' | 'seller';

/** Shop + basket flow. In seller mode the seller builds the same basket for a chosen customer. */
export function PlaceOrderPage({ mode = 'customer' }: { mode?: Mode } = {}) {
  const seller = mode === 'seller';
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const debouncedQ = useDebouncedValue(q, 350);
  // Persist the in-progress order so a refresh, phone call, or
  // accidental back-navigation doesn't wipe the basket.
  const [customerCart, setCustomerCart] = useSessionState<CartItem[]>('op-cart', []);
  const [customerId, setCustomerId] = useSessionState(seller ? 'op-seller-customer' : 'op-unused-customer', '');
  const drafts = useSellerDrafts(seller ? user?.id : undefined);
  const draft = drafts.get(customerId);
  const cart = seller ? draft.cart : customerCart;
  const setCart: Setter<CartItem[]> = seller ? drafts.field(customerId, 'cart') : setCustomerCart;
  const [discardId, setDiscardId] = useState<string | null>(null);
  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<Array<{ id: string; name: string; phone: string }>>('/customers'),
    enabled: seller,
  });
  const selectedCustomer = customersQuery.data?.find((c) => c.id === customerId);
  const [view, setView] = useState<'shop' | 'cart'>(params.get('cart') === '1' ? 'cart' : 'shop');
  const [adjustingBasket, setAdjustingBasket] = useState(false);
  const [customerNote, setCustomerNote] = useSessionState('op-delivery-note', '');
  const [customerCharge, setCustomerCharge] = useSessionState('op-delivery-charge', '0');
  const deliveryInstructions = seller ? draft.deliveryInstructions : customerNote;
  const setDeliveryInstructions: Setter<string> = seller ? drafts.field(customerId, 'deliveryInstructions') : setCustomerNote;
  const deliveryCharge = seller ? draft.deliveryCharge : customerCharge;
  const setDeliveryCharge: Setter<string> = seller ? drafts.field(customerId, 'deliveryCharge') : setCustomerCharge;
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<{
    product: Product;
    variant: Product['variants'][0];
  } | null>(null);
  const [amount, setAmount] = useState('40');
  const [amountError, setAmountError] = useState('');
  const [note, setNote] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [submittedOrder, setSubmittedOrder] = useState<{ id: string; orderNumber: string } | null>(null);

  const cartRequested = params.get('cart') === '1';
  const customerParam = params.get('customerId');
  useEffect(() => {
    if (seller && customerParam) setCustomerId(customerParam);
  }, [seller, customerParam, setCustomerId]);
  useEffect(() => {
    if (cartRequested) setView('cart');
  }, [cartRequested]);

  const productsQuery = useQuery({
    queryKey: [seller ? 'order-products-seller' : 'products', debouncedQ],
    queryFn: () => api<Product[]>(`/products?q=${encodeURIComponent(debouncedQ)}`),
    placeholderData: (prev) => prev,
  });

  // preselect variant from query (?variantId=… from the catalogue "Add" button)
  const preselectId = params.get('variantId');
  const preselectProductId = params.get('productId');
  useEffect(() => {
    if (preselectId || !preselectProductId || !productsQuery.data) return;
    const product = productsQuery.data.find((p) => p.id === preselectProductId);
    if (product) {
      setSelectedProduct(product);
      setParams((previous) => { const next = new URLSearchParams(previous); next.delete('productId'); return next; }, { replace: true });
    }
  }, [preselectId, preselectProductId, productsQuery.data, setParams]);
  useEffect(() => {
    if (!preselectId || !productsQuery.data) return;
    for (const p of productsQuery.data) {
      const v = p.variants.find((x) => x.id === preselectId);
      if (v) {
        setPicker({ product: p, variant: v });
        setAmount(v.unitPrice);
        setParams((previous) => {
          const next = new URLSearchParams(previous);
          next.delete('variantId');
          next.delete('productId');
          return next;
        }, { replace: true });
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsQuery.data, preselectId, setParams]);

  const submitMut = useMutation({
    meta: { silentError: true },
    mutationFn: () =>
      api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: seller ? customerId : undefined,
          items: cart.map((c) => ({
            productId: c.productId,
            variantId: c.variantId,
            isCustom: c.isCustom,
            customName: c.customName,
            customUnit: c.customUnit,
            requestedAmount: c.requestedAmount,
            note: c.note || undefined,
          })),
          deliveryInstructions: deliveryInstructions || undefined,
          estimatedDeliveryCharge: deliveryCharge || 0,
          submit: true,
        }),
      }),
    onSuccess: (order: any) => {
      closeBasket();
      setSubmittedOrder({ id: order.id, orderNumber: order.orderNumber });
      queryClient.invalidateQueries({ queryKey: ['customer-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customer-orders'] });
      queryClient.invalidateQueries({ queryKey: ['seller-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // Clear the saved basket only after the server confirms receipt.
      setCart([]);
      setDeliveryInstructions('');
      setDeliveryCharge('0');
      if (seller) setCustomerId('');
      if (!seller) {
        try {
          sessionStorage.removeItem('op-cart');
        } catch { /* ignore */ }
      }
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not submit order. Check your connection and try again.'),
  });

  const itemsTotal = cart.reduce((s, c) => s + Number(c.requestedAmount || 0), 0);
  const estimatedTotal = itemsTotal + Number(deliveryCharge || 0);
  const hasInvalidAmount = cart.some((item) => !Number.isFinite(Number(item.requestedAmount)) || Number(item.requestedAmount) <= 0);
  const invalidDeliveryCharge = !Number.isFinite(Number(deliveryCharge)) || Number(deliveryCharge) < 0;
  const searching = q !== debouncedQ;
  const suggestedAmounts = picker
    ? (picker.variant.unit === 'KILOGRAM' ? [0.5, 1] : [1, 2])
        .map((quantity) => Math.round(Number(picker.variant.unitPrice) * quantity * 100) / 100)
        .filter((value) => Number.isFinite(value) && value > 0)
    : [];

  function closeBasket() {
    setView('shop');
    setAdjustingBasket(false);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('cart');
      return next;
    }, { replace: true });
  }

  function openPicker(product: Product, variant: Product['variants'][0]) {
    setPicker({ product, variant });
    setAmount(variant.unitPrice);
    setAmountError('');
    setNote('');
  }

  function addFromPicker() {
    if (!picker) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setAmountError('Enter an amount above GH₵0.');
      return;
    }
    const v = picker.variant;
    const label = `${picker.product.name}${
      v.brand || v.name !== 'Standard' ? ` · ${v.brand || v.name}` : ''
    }`;
    const nextItem: CartItem = {
        key: `${v.id}-${Date.now()}`,
        productId: picker.product.id,
        variantId: v.id,
        label,
        unit: v.unit,
        unitPrice: Number(v.unitPrice),
        pricingType: v.pricingType,
        requestedAmount: String(amt),
        note,
      };
    setCart((prev) => [...prev, nextItem]);
    toast.success(`${label} added to basket`);
    setPicker(null);
    setNote('');
    setAmount('40');
    setAmountError('');
  }


  function addCustom() {
    const amt = Number(customAmount);
    if (!customName.trim() || !Number.isFinite(amt) || amt <= 0) return;
    const nextItem: CartItem = {
        key: `custom-${Date.now()}`,
        isCustom: true,
        customName: customName.trim(),
        customUnit: 'PIECE',
        label: customName.trim(),
        unit: 'PIECE',
        unitPrice: amt,
        pricingType: 'FIXED_UNIT',
        requestedAmount: String(amt),
        note: '',
      };
    setCart((prev) => [...prev, nextItem]);
    toast.success(`${nextItem.label} added to basket`);
    setCustomOpen(false);
    setCustomName('');
    setCustomAmount('');
  }


  return (
    <Page
      title={seller ? 'New request for customer' : 'Shop products'}
      subtitle={seller ? 'Pick the customer, add products from the catalogue, then create the request.' : 'Choose products, then enter the amount you want to spend.'}
      backTo={seller ? '/seller' : '/customer'}
      backLabel="Home"
      actions={cart.length > 0 ? <Button variant="secondary" onClick={() => setView('cart')}>Basket · {cart.length}</Button> : undefined}
    >
      {seller ? (
        <Card className="mt-1">
          <label className="block">
            <span className="label">Customer</span>
            <select
              className="input"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={customersQuery.isLoading}
            >
              <option value="">{customersQuery.isLoading ? 'Loading customers…' : 'Select a customer…'}</option>
              {customersQuery.data?.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
            </select>
          </label>
          {!customerId && <p className="mt-2 text-sm text-slate-600">Choose a customer to start, or continue an unfinished request.</p>}
          {Object.keys(drafts.all).length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unfinished requests</div>
              <ul className="mt-2 space-y-2">
                {Object.entries(drafts.all)
                  .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
                  .map(([id, d]) => {
                    const c = customersQuery.data?.find((x) => x.id === id);
                    const total = d.cart.reduce((sum, item) => sum + Number(item.requestedAmount || 0), 0) + Number(d.deliveryCharge || 0);
                    const active = id === customerId;
                    return (
                      <li key={id} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${active ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white'}`}>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setCustomerId(id)} aria-label={`Continue request for ${c?.name || 'customer'}`}>
                          <div className="truncate text-sm font-semibold text-slate-900">{c?.name || 'Customer'}{active && <span className="ml-2 text-xs font-medium text-brand-700">Editing now</span>}</div>
                          <div className="text-xs text-slate-500">{d.cart.length} {d.cart.length === 1 ? 'item' : 'items'} · {ghs(total)} · saved {new Date(d.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </button>
                        {!active && <button type="button" className="min-h-10 rounded-lg px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => setCustomerId(id)}>Continue</button>}
                        <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Discard request for ${c?.name || 'customer'}`} onClick={() => setDiscardId(id)}>
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Switching customer keeps each basket saved here until you create or discard it.</p>
            </div>
          )}
          {customersQuery.data && customersQuery.data.length === 0 && (
            <p className="mt-2 text-sm text-slate-600">No customers yet. <Link className="font-semibold text-brand-700" to="/seller/customers">Add a customer</Link> first.</p>
          )}
        </Card>
      ) : (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" role="note">
          Order in cedis. Enter the amount you want to pay for each item.
        </div>
      )}

      <Dialog
        open={view === 'cart'}
        onClose={closeBasket}
        title={seller ? 'Request basket' : 'Your basket'}
        description={seller ? 'Review the items before creating the request for this customer.' : 'Review your order before sending it to the shop.'}
        closeOnBackdrop={!submitMut.isPending}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={submitMut.isPending} onClick={closeBasket}>Close</Button><Button className="flex-1" disabled={submitMut.isPending || cart.length === 0 || hasInvalidAmount || invalidDeliveryCharge || (seller && !customerId)} onClick={() => { setError(''); submitMut.mutate(); }}>{submitMut.isPending ? (seller ? 'Creating…' : 'Placing…') : (seller ? 'Create request' : 'Place order')}</Button></div>}
      >
        {cart.length === 0 ? <Empty title="Your basket is empty" hint="Add products to start an order." action={<Button onClick={closeBasket}>Shop products</Button>} /> : <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4 text-sm">
            <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order for</div><div className="mt-1 font-semibold text-slate-950">{seller ? (selectedCustomer ? selectedCustomer.name : <span className="text-rose-600">Select a customer</span>) : (user?.name || 'You')}</div></div>
            <div className="text-right"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</div><div className="mt-1 font-semibold text-slate-950">Not placed yet</div></div>
          </div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-900">Items · {cart.length}</span><button type="button" className="min-h-10 rounded-lg border border-brand-200 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => setAdjustingBasket((value) => !value)}>{adjustingBasket ? 'Done editing' : 'Adjust order'}</button></div>
          {cart.map((item) => <div key={item.key} className="border-b border-slate-100 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="text-sm font-semibold text-slate-950">{item.label}</div><div className="mt-1 text-xs text-slate-500">{item.isCustom ? 'Custom request' : `${ghs(item.unitPrice)} / ${unitLabel(item.unit)}`}</div></div>
              {adjustingBasket ? <input aria-label={`Amount for ${item.label}`} className="w-24 shrink-0 rounded-md border border-slate-200 px-2 py-1 text-right text-sm font-bold text-slate-950 focus:border-brand-500 focus:outline-none" type="number" min="0.01" step="0.01" inputMode="decimal" value={item.requestedAmount} onChange={(event) => setCart((previous) => previous.map((line) => line.key === item.key ? { ...line, requestedAmount: event.target.value } : line))} /> : <div className="shrink-0 text-sm font-bold text-slate-950">{ghs(item.requestedAmount)}</div>}
            </div>
            {adjustingBasket ? <div className="mt-2 flex items-center gap-2"><input aria-label={`Note for ${item.label}`} className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none" placeholder="Item note (optional)" value={item.note} onChange={(event) => setCart((previous) => previous.map((line) => line.key === item.key ? { ...line, note: event.target.value } : line))} /><button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-rose-600 hover:bg-rose-50" aria-label={`Remove ${item.label}`} onClick={() => setCart((previous) => previous.filter((line) => line.key !== item.key))}><Icon name="trash" className="h-4 w-4" /></button></div> : item.note && <div className="mt-1 text-xs text-slate-600">Note: {item.note}</div>}
          </div>)}
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600"><span>Items subtotal</span><span>{ghs(itemsTotal)}</span></div>
            <div className="mt-2 flex items-center justify-between text-slate-600"><span>Delivery</span>{adjustingBasket ? <input aria-label="Delivery charge" className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none" type="number" min="0" step="0.01" inputMode="decimal" value={deliveryCharge} onChange={(event) => setDeliveryCharge(event.target.value)} /> : <span>{ghs(deliveryCharge)}</span>}</div>
            <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-bold text-slate-950"><span>Total</span><span>{ghs(estimatedTotal)}</span></div>
          </div>
          {adjustingBasket ? <TextArea label="Delivery instructions (optional)" value={deliveryInstructions} onChange={(event) => setDeliveryInstructions(event.target.value)} placeholder="Landmark, gate, call on arrival…" /> : deliveryInstructions && <p className="text-sm text-slate-600">Delivery instructions: {deliveryInstructions}</p>}
          {(hasInvalidAmount || invalidDeliveryCharge) && <p className="text-sm font-medium text-rose-600">Enter a valid amount above GH₵0 for each item and a nonnegative delivery charge.</p>}
          {error && <ErrorBox message={error} />}
          <p className="text-center text-xs text-slate-500">{seller ? 'The request goes to your New requests queue. Prepare the invoice from there.' : 'No payment is collected now. The shop will prepare your items.'}</p>
        </div>}
      </Dialog>

      <Dialog
        open={!!picker}
        onClose={() => setPicker(null)}
        title={picker ? [picker.product.name, picker.variant.brand, picker.variant.name].filter(Boolean).join(' · ') : 'Add product'}
        description={picker ? (picker.variant.pricingType === 'PER_MEASUREMENT' ? `${ghs(picker.variant.unitPrice)} per ${unitLabel(picker.variant.unit)}` : `${ghs(picker.variant.unitPrice)} / ${unitLabel(picker.variant.unit)}`) : undefined}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setPicker(null)}>Cancel</Button><Button variant="success" className="flex-1" onClick={addFromPicker}>Add to basket</Button></div>}
      >
        {picker && <div className="space-y-4">
            <div>
              <Input
                label={seller ? 'Amount (GH₵)' : 'Amount I want (GH₵)'}
                type="number"
                min="1"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setAmountError(''); }}
                aria-invalid={!!amountError}
                aria-describedby={amountError ? 'amount-error' : undefined}
              />
              {amountError && <p id="amount-error" className="mt-1 text-xs font-medium text-rose-600">{amountError}</p>}

              <div className="mt-2 flex flex-wrap justify-end gap-2" role="group" aria-label="Quick amounts">
                {suggestedAmounts.map((qa) => (
                  <button
                    key={qa}
                    type="button"
                    onClick={() => { setAmount(String(qa)); setAmountError(''); }}
                    className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${Number(amount) === qa ? 'bg-brand-700 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-300'}`}
                  >
                    {ghs(qa)}
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. medium pieces"
            />
          </div>}
      </Dialog>

      <>
      {(!seller || customerId) && (
      <div className="mx-auto mt-5 w-full max-w-xl" role="search">
        <Input
          label="Search products"
          className="w-full"
          placeholder="Search catalogue…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      )}
      </>

      <Dialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        title="Custom product request"
        description="Can't find it in the catalogue? Tell the seller what you need."
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setCustomOpen(false)}>Cancel</Button><Button variant="success" className="flex-1" onClick={addCustom} disabled={!customName.trim() || !Number.isFinite(Number(customAmount)) || Number(customAmount) <= 0}>Add to basket</Button></div>}
      >
          <div className="space-y-4">
            <Input
              label="What do you need?"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. Smoked salmon"
            />
            <Input
              label="Amount I want (GH₵)"
              type="number"
              min="1"
              step="0.01"
              inputMode="decimal"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
          </div>
      </Dialog>

      {(!seller || customerId) && (
      <div className="mt-4 space-y-3" aria-live="polite">
        {(productsQuery.isLoading || searching) && !productsQuery.data?.length ? (
          <Loading label={searching ? 'Searching…' : 'Loading products…'} />
        ) : !productsQuery.data?.length ? (
          <Empty
            title={debouncedQ ? 'No products match your search' : 'No products'}
            hint={debouncedQ ? 'Try a different spelling.' : undefined}
            action={debouncedQ ? <Button variant="secondary" onClick={() => setQ('')}>Clear search</Button> : undefined}
          />
        ) : (
          productsQuery.data.map((p) => (
            <Card key={p.id}>
              <div className="font-semibold">{p.name}</div>
              <button type="button" className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-left hover:bg-brand-50" onClick={() => setSelectedProduct(p)} aria-label={'Choose variation for ' + p.name}>
                <span className="text-sm text-slate-600">{variationSummary(p)}</span>
                <span className="shrink-0 text-sm font-semibold text-brand-700">Choose variation</span>
              </button>
            </Card>
          ))
        )}
      </div>
      )}

      {!seller && cart.length === 0 && (
        <p className="mt-4 text-center text-sm text-slate-500">
          Or browse the full <Link className="font-medium text-brand-700" to="/customer/catalogue">catalogue</Link>
        </p>
      )}


      <ConfirmDialog
        open={!!discardId}
        onClose={() => setDiscardId(null)}
        onConfirm={() => {
          if (!discardId) return;
          const name = customersQuery.data?.find((x) => x.id === discardId)?.name || 'customer';
          drafts.remove(discardId);
          if (discardId === customerId) setCustomerId('');
          setDiscardId(null);
          toast.info(`Discarded the unfinished request for ${name}`);
        }}
        title="Discard this request?"
        description="The items in this unfinished basket will be removed. This cannot be undone."
        confirmLabel="Discard"
        danger
      />

      <SuccessScreen
        open={!!submittedOrder}
        title={seller ? 'Request created!' : 'Order placed!'}
        message={seller ? 'The customer has been notified. Open the request to prepare the invoice.' : 'The shop is preparing your items. You’ll be notified when it’s ready.'}
        primary={{ label: seller ? 'Open request' : 'Track my order', onClick: () => submittedOrder && navigate(seller ? `/seller/orders/${submittedOrder.id}` : `/customer/orders/${submittedOrder.id}`) }}
        secondary={{ label: 'Back to Home', onClick: () => navigate(seller ? '/seller' : '/customer') }}
      >
        {submittedOrder && (
          <div className="rounded-2xl bg-slate-50 px-4 py-4">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Order number</span>
            <strong className="mt-1 block text-xl text-slate-950">{submittedOrder.orderNumber}</strong>
          </div>
        )}
      </SuccessScreen>
      <ProductVariations key={selectedProduct?.id || 'closed'} product={selectedProduct} onClose={() => setSelectedProduct(null)} onSelect={(v) => { if (selectedProduct) openPicker(selectedProduct, v); setSelectedProduct(null); }} />
    </Page>
  );
}
