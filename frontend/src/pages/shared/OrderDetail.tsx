import { PreparedOrder } from '../../components/PreparedOrder';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatWhen, ghs, orderStatusHint, orderStatusLabel, unitLabel } from '../../lib/format';
import { lineAmount, quantityForAmount } from '../../lib/invoiceMath';
import { toast } from '../../lib/toast';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  StatusBadge,
  TextArea,
} from '../../components/ui';

export function OrderDetailPage({ basePath }: { basePath: 'customer' | 'seller' }) {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [phoneNote, setPhoneNote] = useState('');
  const [error, setError] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deliverConfirm, setDeliverConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepEditing, setPrepEditing] = useState(false);
  const [prepLines, setPrepLines] = useState<any[]>([]);
  const [prepDeliveryCharge, setPrepDeliveryCharge] = useState('0');
  const [prepNote, setPrepNote] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<any>(`/orders/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (basePath !== 'seller' || !order || searchParams.get('invoice') !== 'edit') return;
    if (!['SUBMITTED', 'PREPARING', 'CHANGE_REQUESTED', 'AWAITING_CUSTOMER_APPROVAL'].includes(order.status) && !(order.status === 'AGREED' && Number(order.amountPaid) === 0)) return;
    const latest = order.revisions?.[order.revisions.length - 1];
    setPrepDeliveryCharge(String(latest?.deliveryCharge ?? order.estimatedDeliveryCharge ?? '0'));
    setPrepNote(latest?.preparationNote ?? '');
    setPrepEditing(false);
    setPrepLines(order.requestItems.map((ri: any) => {
      const previous = latest?.items?.find((line: any) => line.requestItemId === ri.id);
      const actualQuantity = previous && !previous.isRemoved ? previous.actualQuantity : ri.estimatedQuantity;
      const confirmedUnitPrice = previous && !previous.isRemoved ? previous.confirmedUnitPrice : ri.catalogueUnitPrice;
      const note = previous?.note ?? ri.note ?? '';
      return {
        requestItemId: ri.id,
        productNameSnapshot: ri.productNameSnapshot,
        variantNameSnapshot: ri.variantNameSnapshot,
        brandSnapshot: ri.brandSnapshot,
        unitSnapshot: ri.unitSnapshot,
        pricingTypeSnapshot: ri.pricingTypeSnapshot,
        catalogueUnitPrice: ri.catalogueUnitPrice,
        confirmedUnitPrice,
        showUnitPrice: Number(confirmedUnitPrice) !== Number(ri.catalogueUnitPrice),
        showNote: !!note,
        priceChangeReason: previous?.priceChangeReason ?? '',
        requestedAmount: ri.requestedAmount,
        estimatedQuantity: ri.estimatedQuantity,
        actualQuantity,
        finalAmount: lineAmount(actualQuantity, confirmedUnitPrice),
        isRemoved: false,
        isReplacement: false,
        note,
      };
    }));
    setPrepOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('invoice');
    setSearchParams(next, { replace: true });
  }, [basePath, order, searchParams, setSearchParams]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['seller-dashboard'] });
    qc.invalidateQueries({ queryKey: ['customer-dashboard'] });
    qc.invalidateQueries({ queryKey: ['orders'] });
  };

  const mut = useMutation({
    meta: { silentError: true },
    mutationFn: async (vars: { path: string; body?: unknown }) =>
      api(`/orders/${id}/${vars.path}`, {
        method: 'POST',
        body: vars.body ? JSON.stringify(vars.body) : undefined,
      }),
    onSuccess: (_data, vars) => {
      const messages: Record<string, string> = {
        deliver: 'Order marked completed',
        'agree-phone': 'Phone approval saved',
        'flag-price': 'Sent to the seller',
        cancel: 'Order cancelled',
      };
      toast.success(messages[vars.path] || 'Order updated');
      setError('');
      setFlagOpen(false);
      setFlagNote('');
      setCancelOpen(false);
      setCancelReason('');
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Action failed'),
  });

  const batchPrepMut = useMutation({
    meta: { silentError: true },
    mutationFn: async (sendForApproval: boolean) => {
      const items = prepLines.map((line) => ({
        requestItemId: line.requestItemId,
        productNameSnapshot: line.productNameSnapshot,
        variantNameSnapshot: line.variantNameSnapshot,
        brandSnapshot: line.brandSnapshot,
        unitSnapshot: line.unitSnapshot,
        pricingTypeSnapshot: line.pricingTypeSnapshot,
        catalogueUnitPrice: line.catalogueUnitPrice,
        confirmedUnitPrice: line.confirmedUnitPrice,
        priceChangeReason: line.priceChangeReason?.trim() || undefined,
        requestedAmount: line.requestedAmount,
        estimatedQuantity: line.estimatedQuantity,
        actualQuantity: line.actualQuantity,
        isRemoved: false,
        isReplacement: line.isReplacement ?? false,
        note: line.note,
      }));
      return api(`/orders/${id}/prepare`, {
        method: 'POST',
        body: JSON.stringify({
          items,
          deliveryCharge: prepDeliveryCharge,
          preparationNote: prepNote || undefined,
          sendForApproval,
          finalizeIfWithinTolerance: true,
        }),
      });
    },
    onSuccess: (_data, sendForApproval) => {
      toast.success(sendForApproval ? 'Sent to customer for approval' : 'Preparation saved');
      setPrepOpen(false);
      setError('');
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not save preparation'),
  });

  if (isLoading) return <Loading />;
  if (!order) return <Page title="Order"><Empty title="Order not found" /></Page>;

  const latestRev = order.revisions?.[order.revisions.length - 1];
  const isSeller = user?.role === 'SELLER';
  const prepItemsTotal = prepLines.reduce((sum, line) =>
    sum + Number(lineAmount(line.actualQuantity, line.confirmedUnitPrice)), 0);
  const prepGrandTotal = prepItemsTotal + Number(prepDeliveryCharge || 0);
  const invoiceChanged = prepLines.some((line) =>
    Number(line.actualQuantity) !== Number(line.estimatedQuantity) ||
    Number(line.confirmedUnitPrice) !== Number(line.catalogueUnitPrice) ||
    Number(lineAmount(line.actualQuantity, line.confirmedUnitPrice)) !== Number(line.requestedAmount)
  ) || Number(prepDeliveryCharge) !== Number(order.estimatedDeliveryCharge);

  return (
    <Page
      title={order.orderNumber}
      subtitle={isSeller ? order.customer?.name : undefined}
      backTo={basePath === 'seller' ? '/seller/orders' : '/customer/orders'}
      backLabel="Orders"
    >
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}

      <div className="mb-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0 flex-1"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current status</div><div className="mt-1"><StatusBadge status={order.status} label={orderStatusLabel(order.status, isSeller ? 'seller' : 'customer')} /></div>{orderStatusHint(order.status, isSeller ? 'seller' : 'customer') && <p className="mt-2 text-sm text-slate-600">{orderStatusHint(order.status, isSeller ? 'seller' : 'customer')}</p>}</div>
      </div>
      {order.status === 'CANCELLED' && order.cancelReason && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><strong>Cancellation reason:</strong> {order.cancelReason}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <div className="text-xs text-slate-500">Order total</div>
          <div className="text-lg font-bold">{ghs(latestRev?.grandTotal ?? order.estimatedTotal)}</div>
        </Card>
        <Card className={!order.agreedTotal ? 'border-slate-200 bg-slate-50/70' : Number(order.outstandingBalance) > 0 ? 'border-rose-200 bg-rose-50/70' : 'border-emerald-200 bg-emerald-50/60'}>
          <div className="text-xs text-slate-500">Payment status</div>
          {!order.agreedTotal ? <><div className="text-lg font-bold text-slate-700">Awaiting order preparation</div><div className="mt-1 text-xs font-medium text-slate-500">The payment button will appear when your order is ready.</div></> : <><div className={`text-lg font-bold ${Number(order.outstandingBalance) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{ghs(order.outstandingBalance)}</div><div className={`mt-1 text-xs font-medium ${Number(order.outstandingBalance) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{Number(order.outstandingBalance) > 0 ? 'Payment due' : 'Paid in full'}</div></>}
        </Card>
      </div>

      {latestRev && !isSeller && <PreparedOrder order={order} revision={latestRev} />}
      <details className="mt-6" open={isSeller || !latestRev}>
        <summary className="mb-2 cursor-pointer font-semibold">{latestRev ? 'View original request' : 'Original request'}</summary>
        <Card>
          <div className="mb-4 flex justify-between gap-4 border-b border-slate-200 pb-4 text-sm">
            <div><div className="text-xs uppercase text-slate-500">Requested by</div><div className="mt-1 font-semibold">{order.customer?.name || 'You'}</div>{order.customer?.phone && <div className="mt-1 text-xs text-slate-500">{order.customer.phone}</div>}</div>
            <div className="text-right"><div className="text-xs uppercase text-slate-500">Order</div><div className="mt-1 font-semibold">{order.orderNumber}</div><div className="mt-1 text-xs text-slate-500">{formatWhen(order.createdAt)}</div></div>
          </div>
          {isSeller && (['SUBMITTED', 'PREPARING', 'CHANGE_REQUESTED', 'AWAITING_CUSTOMER_APPROVAL'].includes(order.status) || (order.status === 'AGREED' && Number(order.amountPaid) === 0)) && (
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <span className="text-sm text-slate-500">Items</span>
              <Button variant="secondary" className="shrink-0" onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set('invoice', 'edit');
                setSearchParams(next);
              }}>Edit invoice</Button>
            </div>
          )}
          {order.deliveryInstructions && (
            <p className="mb-3 text-sm text-slate-600">
              Delivery: {order.deliveryInstructions}
            </p>
          )}
          <div className="divide-y divide-slate-100">
            {order.requestItems?.map((item: any) => (
              <div key={item.id} className="py-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="font-semibold">{[item.productNameSnapshot, item.variantNameSnapshot].filter(Boolean).join(' · ')}{item.isCustom ? ' (custom)' : ''}</div>
                  <div className="shrink-0 font-bold">{ghs(item.requestedAmount)}</div>
                </div>
                <div className="mt-1 text-xs text-slate-500">{Number(item.estimatedQuantity)} {unitLabel(item.unitSnapshot)} × {ghs(item.catalogueUnitPrice)}</div>
                {item.note && <p className="mt-1 text-xs text-slate-600">Note: {item.note}</p>}
              </div>
            ))}
          </div>
          <div className="mt-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            <div className="flex justify-between gap-3"><span>Items subtotal</span><span>{ghs(Number(order.estimatedTotal) - Number(order.estimatedDeliveryCharge || 0))}</span></div>
            <div className="mt-2 flex justify-between gap-3"><span>Delivery</span><span>{ghs(order.estimatedDeliveryCharge)}</span></div>
            <div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3 text-lg font-bold text-slate-950"><span>Total</span><span>{ghs(order.estimatedTotal)}</span></div>
          </div>
        </Card>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        {basePath === 'customer' && order.status === 'AWAITING_CUSTOMER_APPROVAL' && (
          <Link to={`/customer/orders/${order.id}/approve`}><Button>Review adjustment</Button></Link>
        )}
        {basePath === 'customer' && !isSeller && order.agreedTotal && Number(order.outstandingBalance) > 0 && ['AGREED', 'DELIVERED', 'COMPLETED'].includes(order.status) && (
          <Link to={`/pay/${order.id}`}><Button variant="success">Pay with MoMo</Button></Link>
        )}
        {basePath === 'customer' && order.status === 'AGREED' && Number(order.amountPaid) === 0 && (
          <Button variant="secondary" onClick={() => setFlagOpen(true)}>Flag a price issue</Button>
        )}
        {isSeller && ['SUBMITTED', 'AGREED', 'READY_FOR_DELIVERY', 'DISPATCHED', 'DELIVERED'].includes(order.status) && (
          <Button variant="success" disabled={mut.isPending} onClick={() => setDeliverConfirm(true)}>
            {mut.isPending ? 'Saving...' : order.status === 'SUBMITTED' && order.customer?.autoApproveUnchanged === false ? 'Send unchanged order for approval' : 'Mark completed'}
          </Button>
        )}
        {isSeller && ['DRAFT', 'SUBMITTED', 'PREPARING', 'AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED', 'AGREED', 'READY_FOR_DELIVERY', 'DISPATCHED'].includes(order.status) && Number(order.amountPaid) === 0 && (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel order</Button>
        )}
      </div>

      {isSeller && order.status === 'AWAITING_CUSTOMER_APPROVAL' && (
        <Card className="mt-4">
          <h3 className="font-semibold">Record telephone approval</h3>
          <p className="mt-1 text-sm text-slate-500">Use phone approval only when the customer confirmed the final amount by call.</p>
          <TextArea className="mt-3" label="Required note" value={phoneNote} onChange={(e) => setPhoneNote(e.target.value)} placeholder="Spoke with customer and confirmed the final total" />
          <Button className="mt-3" variant="secondary" disabled={!phoneNote.trim() || mut.isPending} onClick={() => mut.mutate({ path: 'agree-phone', body: { note: phoneNote } })}>Save phone approval</Button>
        </Card>
      )}

      {isSeller && order.revisions?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Revisions</h2>
          <div className="space-y-3">
            {order.revisions.map((rev: any) => (
              <Card key={rev.id} className={rev.isLocked ? 'border-emerald-200' : ''}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold">Revision #{rev.revisionNumber}</div>
                  <div className="flex gap-2 text-xs">
                    {rev.isLocked && (
                      <span className="badge bg-emerald-100 text-emerald-800">Locked invoice</span>
                    )}
                    {rev.agreement && (
                      <span className="badge bg-slate-100 text-slate-700">
                        {rev.agreement.method}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>Items: {ghs(rev.itemsTotal)}</div>
                  <div>Delivery: {ghs(rev.deliveryCharge)}</div>
                  <div>Total: <strong>{ghs(rev.grandTotal)}</strong></div>
                  <div>
                    Diff:{' '}
                    <span className={Number(rev.differenceAmount) > 0 ? 'text-amber-700' : ''}>
                      {ghs(rev.differenceAmount)} ({rev.differencePercent}%)
                    </span>
                  </div>
                </div>
                {rev.preparationNote && (
                  <p className="mt-2 text-sm text-slate-600">Prep note: {rev.preparationNote}</p>
                )}
                {rev.changeRequestNote && (
                  <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900">
                    Change requested: {rev.changeRequestNote}
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {rev.items?.map((item: any) => (
                    <div
                      key={item.id}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        item.isRemoved ? 'border-rose-100 bg-rose-50 opacity-70' : 'border-slate-100'
                      }`}
                    >
                      <div className="font-medium">
                        {item.productNameSnapshot}
                        {item.variantNameSnapshot ? `  ${item.variantNameSnapshot}` : ''}
                        {item.isRemoved ? ' (removed)' : ''}
                        {item.isReplacement ? ' (added)' : ''}
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-1 text-slate-600 sm:grid-cols-4">
                        <span>Req {ghs(item.requestedAmount)}</span>
                        <span>
                          Actual {item.actualQuantity} {unitLabel(item.unitSnapshot)}
                        </span>
                        <span>@ {ghs(item.confirmedUnitPrice)}</span>
                        <span className="font-semibold text-slate-800">
                          {ghs(item.actualLineTotal)}
                        </span>
                      </div>
                      {item.priceChangeReason && (
                        <div className="mt-1 text-xs text-amber-700">
                          Adjustment reason: {item.priceChangeReason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {isSeller && order.agreements?.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Agreements</h2>
          {order.agreements.map((a: any) => (
            <Card key={a.id} className="mb-2">
              <div className="flex justify-between gap-2">
                <div className="font-medium">
                  {a.method === 'DIGITAL'
                    ? 'Customer accepted digitally'
                    : a.method === 'PHONE'
                      ? 'Telephone approval'
                      : 'Finalized at requested total'}
                </div>
                <div className="text-sm text-slate-500">{formatWhen(a.agreedAt)}</div>
              </div>
              <div className="mt-1 text-sm">Final total: {ghs(a.agreedTotal)}</div>
              {a.phoneNote && <p className="mt-1 text-sm text-slate-600">{a.phoneNote}</p>}
              {a.customerNote && <p className="mt-1 text-sm text-slate-600">{a.customerNote}</p>}
              {a.recordedBy && (
                <p className="mt-1 text-xs text-slate-500">Recorded by {a.recordedBy.name}</p>
              )}
            </Card>
          ))}
        </section>
      )}

      {order.delivery && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Delivery</h2>
          <Card>
            <div className="flex justify-between">
              <StatusBadge status={order.delivery.status} />
              <span className="text-sm text-slate-500">
                {order.delivery.deliveredAt
                  ? formatWhen(order.delivery.deliveredAt)
                  : order.delivery.dispatchedAt
                    ? formatWhen(order.delivery.dispatchedAt)
                    : ''}
              </span>
            </div>
            {order.delivery.courierName && (
              <p className="mt-2 text-sm">Courier: {order.delivery.courierName}</p>
            )}
            {order.delivery.instructions && (
              <p className="mt-1 text-sm text-slate-600">{order.delivery.instructions}</p>
            )}
            {order.delivery.proofNote && (
              <p className="mt-1 text-sm">Proof: {order.delivery.proofNote}</p>
            )}
          </Card>
        </section>
      )}

      {(order.paymentAttempts?.length > 0 || order.payments?.length > 0) && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Payments</h2>
          <div className="space-y-2">
            {order.payments?.map((p: any) => (
              <Link key={p.id} to={`/${basePath}/receipts/${p.id}`}>
                <Card>
                  <div className="flex justify-between">
                    <div className="font-medium text-emerald-800">Verified {ghs(p.amount)}</div>
                    <div className="text-sm text-slate-500">{formatWhen(p.paidAt)}</div>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {p.network}  Receipt {p.receiptNumber}
                  </div>
                </Card>
              </Link>
            ))}
            {order.paymentAttempts
              ?.filter((a: any) => a.status !== 'SUCCESS')
              .map((a: any) => (
                <Card key={a.id}>
                  <div className="flex justify-between">
                    <div className="font-medium">
                      Attempt {a.status}: {ghs(a.amount)}
                    </div>
                    <div className="text-sm text-slate-500">{formatWhen(a.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{isSeller ? a.internalReference : a.status}</div>
                </Card>
              ))}
          </div>
        </section>
      )}

      <section className="mt-6 mb-8">
        <h2 className="mb-2 font-semibold">Shared timeline</h2>
        <Card>
          {!order.timeline?.length ? (
            <p className="text-sm text-slate-500">No events yet.</p>
          ) : (
            <ol className="space-y-4">
              {order.timeline.map((ev: any, idx: number) => (
                <li key={idx} className="relative border-l-2 border-brand-100 pl-4">
                  <div className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-600" />
                  <div className="text-sm font-semibold text-slate-900">{ev.title}</div>
                  <div className="text-xs text-slate-500">
                    {formatWhen(ev.at)}
                    {ev.actor ? `  ${ev.actor}` : ''}
                  </div>
                  {ev.detail && <div className="mt-0.5 text-sm text-slate-600">{ev.detail}</div>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      {latestRev && basePath === 'customer' && order.status === 'AWAITING_CUSTOMER_APPROVAL' && (
        <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] rounded-xl bg-violet-700 p-3 text-center text-white shadow-lg">
          <Link to={`/customer/orders/${order.id}/approve`} className="font-semibold">
            This order needs your approval — review changes
          </Link>
        </div>
      )}

      <Dialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        title="Flag a price issue"
        description="Use this if the amount shown is not what you agreed on during the call."
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setFlagOpen(false)}>Cancel</Button><Button className="flex-1" disabled={!flagNote.trim() || mut.isPending} onClick={() => mut.mutate({ path: 'flag-price', body: { message: flagNote.trim() } })}>{mut.isPending ? 'Sending…' : 'Send to seller'}</Button></div>}
      >
        <TextArea label="What is wrong with the price?" value={flagNote} onChange={(e) => setFlagNote(e.target.value)} placeholder="The amount shown is different from what we agreed on the phone." />
        <p className="mt-3 text-sm leading-5 text-slate-500">Payment will be paused while you and the seller discuss and revise the order.</p>
      </Dialog>

      {/* One invoice editor for the complete order */}
      <Dialog
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        title={`Invoice · ${order.orderNumber}`}
        description={prepEditing ? 'Update only the items that differ from the customer request.' : 'Review the prepared invoice before confirming it.'}
        closeOnBackdrop={!batchPrepMut.isPending}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={batchPrepMut.isPending} onClick={() => prepEditing ? setPrepEditing(false) : setPrepOpen(false)}>{prepEditing ? 'Review invoice' : 'Close'}</Button><Button className="flex-1" disabled={batchPrepMut.isPending} onClick={() => batchPrepMut.mutate(true)}>{batchPrepMut.isPending ? 'Saving...' : invoiceChanged || order.customer?.autoApproveUnchanged === false ? 'Send for approval' : 'Confirm invoice'}</Button></div>}
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1 pb-2">
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
            <div><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared for</div><div className="mt-1 font-semibold text-slate-950">{order.customer?.name}</div><div className="text-sm text-slate-500">{order.customer?.phone}</div></div>
            <div className="text-right"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order</div><div className="mt-1 font-semibold text-slate-950">{order.orderNumber}</div><div className="text-xs text-slate-500">{formatWhen(order.createdAt)}</div></div>
          </div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-900">Items</span>{!prepEditing && <button type="button" className="min-h-10 rounded-lg border border-brand-200 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => setPrepEditing(true)}>Adjust invoice</button>}</div>
          {prepLines.map((line, idx) => (
            <div key={line.requestItemId} className="border-b border-slate-100 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="text-sm font-semibold text-slate-950">{line.productNameSnapshot}{line.variantNameSnapshot ? ` · ${line.variantNameSnapshot}` : ''}</div><div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">{prepEditing ? <input aria-label={`Quantity for ${line.productNameSnapshot}`} className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none" type="number" step="0.0001" min="0" value={line.actualQuantity} onChange={(e) => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], actualQuantity: e.target.value, finalAmount: lineAmount(e.target.value, line.confirmedUnitPrice) }; setPrepLines(copy); }} /> : line.actualQuantity} <span>{unitLabel(line.unitSnapshot)} × {ghs(line.confirmedUnitPrice)}</span></div></div>
                {prepEditing ? <label className="shrink-0 text-right text-xs text-slate-500">Amount (GH₵)<input aria-label={`Amount for ${line.productNameSnapshot}`} className="mt-1 block w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-sm font-bold text-slate-950 focus:border-brand-500 focus:outline-none" type="number" step="0.01" min="0" value={line.finalAmount} onChange={(e) => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], finalAmount: e.target.value, actualQuantity: quantityForAmount(e.target.value, line.confirmedUnitPrice) }; setPrepLines(copy); }} onBlur={() => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], finalAmount: lineAmount(line.actualQuantity, line.confirmedUnitPrice) }; setPrepLines(copy); }} /></label> : <div className="shrink-0 text-sm font-bold text-slate-950">{ghs(lineAmount(line.actualQuantity, line.confirmedUnitPrice))}</div>}
              </div>
              {prepEditing ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], showUnitPrice: !line.showUnitPrice }; setPrepLines(copy); }}>{line.showUnitPrice ? 'Hide unit price' : 'Correct unit price'}</button>
                <button type="button" className="text-xs font-semibold text-brand-700" onClick={() => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], showNote: !line.showNote }; setPrepLines(copy); }}>{line.showNote ? 'Hide item note' : line.note ? 'View item note' : 'Add item note'}</button>
              </div> : line.note && <div className="mt-1 text-xs text-slate-600">Note: {line.note}</div>}
              {prepEditing && line.showUnitPrice && <Input className="mt-2" label={`Corrected unit price (GH₵ / ${unitLabel(line.unitSnapshot)})`} type="number" step="0.01" min="0" value={line.confirmedUnitPrice} onChange={(e) => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], confirmedUnitPrice: e.target.value, finalAmount: lineAmount(line.actualQuantity, e.target.value) }; setPrepLines(copy); }} />}
              {prepEditing && line.showNote && <Input className="mt-2" label="Item note (optional)" value={line.note || ''} onChange={(e) => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], note: e.target.value }; setPrepLines(copy); }} placeholder="e.g. Cut into smaller pieces" />}
              {prepEditing && (Math.abs(Number(line.actualQuantity || 0) * Number(line.confirmedUnitPrice || 0) - Number(line.requestedAmount || 0)) > 0.01 || Number(line.actualQuantity) !== Number(line.estimatedQuantity) || Number(line.confirmedUnitPrice) !== Number(line.catalogueUnitPrice)) && (
                <Input className="mt-2" label="Reason for change (required)" value={line.priceChangeReason || ''} onChange={(e) => { const copy = [...prepLines]; copy[idx] = { ...copy[idx], priceChangeReason: e.target.value }; setPrepLines(copy); }} />
              )}
              {!prepEditing && line.priceChangeReason && <div className="mt-1 text-xs text-amber-700">Change: {line.priceChangeReason}</div>}
            </div>
          ))}
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600"><span>Items subtotal</span><span>{ghs(prepItemsTotal)}</span></div>
            <div className="mt-2 flex items-center justify-between text-slate-600"><span>Delivery</span>{prepEditing ? <input aria-label="Delivery charge" className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none" type="number" step="0.01" min="0" value={prepDeliveryCharge} onChange={(e) => setPrepDeliveryCharge(e.target.value)} /> : <span>{ghs(prepDeliveryCharge)}</span>}</div>
            <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-bold text-slate-950"><span>Total</span><span>{ghs(prepGrandTotal)}</span></div>
          </div>
          {prepEditing ? <TextArea label="Invoice note (optional)" value={prepNote} onChange={(e) => setPrepNote(e.target.value)} /> : prepNote && <p className="text-sm text-slate-600">Note: {prepNote}</p>}
          {error && <ErrorBox message={error} />}
        </div>
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        description="The order will remain in the history as cancelled and cannot continue to payment or delivery."
        closeOnBackdrop={!mut.isPending}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={mut.isPending} onClick={() => setCancelOpen(false)}>Keep order</Button><Button variant="danger" className="flex-1" disabled={!cancelReason.trim() || mut.isPending} onClick={() => mut.mutate({ path: 'cancel', body: { reason: cancelReason.trim() } })}>{mut.isPending ? 'Cancelling…' : 'Cancel order'}</Button></div>}
      >
        <TextArea label="Why are you cancelling?" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Item unavailable, customer cancelled, duplicate order?" />
        <p className="mt-3 text-sm text-slate-500">The customer will be able to see this reason.</p>
      </Dialog>
          <ConfirmDialog
        open={deliverConfirm}
        onClose={() => setDeliverConfirm(false)}
        onConfirm={() => { setDeliverConfirm(false); mut.mutate({ path: 'deliver', body: { proofNote: 'Marked as completed by seller' } }); }}
        title="Mark this order completed?"
        description="The customer will see it as fulfilled. Only do this after the goods have been handed over."
        confirmLabel="Mark completed"
        busy={mut.isPending}
      />
</Page>
  );
}

