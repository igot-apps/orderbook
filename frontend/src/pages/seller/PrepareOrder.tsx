import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { ghs, unitLabel } from '../../lib/format';
import { toast } from '../../lib/toast';
import {
  Button,
  Card,
  Dialog,
  ErrorBox,
  Input,
  Loading,
  Page,
  TextArea,
} from '../../components/ui';

type PrepLine = {
  requestItemId?: string;
  productNameSnapshot: string;
  variantNameSnapshot?: string;
  brandSnapshot?: string;
  unitSnapshot: string;
  pricingTypeSnapshot: string;
  catalogueUnitPrice: string;
  confirmedUnitPrice: string;
  priceChangeReason?: string;
  requestedAmount: string;
  estimatedQuantity: string;
  actualQuantity: string;
  isRemoved: boolean;
  isReplacement: boolean;
  note?: string;
};

function lineTotal(line: PrepLine) {
  if (line.isRemoved) return 0;
  return Number(line.actualQuantity || 0) * Number(line.confirmedUnitPrice || 0);
}

export function PrepareOrderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [lines, setLines] = useState<PrepLine[]>([]);
  const [deliveryCharge, setDeliveryCharge] = useState('0');
  const [preparationNote, setPreparationNote] = useState('');
  const [error, setError] = useState('');
  const [addName, setAddName] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [phoneApprovalOpen, setPhoneApprovalOpen] = useState(false);
  const [phoneApprovalNote, setPhoneApprovalNote] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<any>(`/orders/${id}`),
  });

  useEffect(() => {
    if (!order) return;
    setDeliveryCharge(String(order.estimatedDeliveryCharge || '0'));
    setLines(
      order.requestItems.map((item: any) => ({
        requestItemId: item.id,
        productNameSnapshot: item.productNameSnapshot,
        variantNameSnapshot: item.variantNameSnapshot,
        brandSnapshot: item.brandSnapshot,
        unitSnapshot: item.unitSnapshot,
        pricingTypeSnapshot: item.pricingTypeSnapshot,
        catalogueUnitPrice: item.catalogueUnitPrice,
        confirmedUnitPrice: item.catalogueUnitPrice,
        requestedAmount: item.requestedAmount,
        estimatedQuantity: item.estimatedQuantity,
        actualQuantity: item.estimatedQuantity,
        isRemoved: false,
        isReplacement: false,
        note: item.note,
      }))
    );
  }, [order?.id]);

  useEffect(() => {
    if (!order) return;
    if (['SUBMITTED', 'CHANGE_REQUESTED'].includes(order.status)) {
      api(`/orders/${id}/prepare/start`, { method: 'POST' }).catch(() => undefined);
    }
  }, [order?.status, id]);

  const itemsTotal = useMemo(
    () => lines.reduce((s, l) => s + lineTotal(l), 0),
    [lines]
  );
  const grandTotal = itemsTotal + Number(deliveryCharge || 0);
  const requestedTotal =
    Number(order?.requestedItemsTotal || 0) + Number(order?.estimatedDeliveryCharge || 0);
  const diff = grandTotal - requestedTotal;

  const saveMut = useMutation({
    meta: { silentError: true },
    mutationFn: (sendForApproval: boolean) =>
      api(`/orders/${id}/prepare`, {
        method: 'POST',
        body: JSON.stringify({
          items: lines,
          deliveryCharge,
          preparationNote: preparationNote || undefined,
          sendForApproval,
        }),
      }),
    onSuccess: (res: any, sendForApproval) => {
      toast.success(sendForApproval ? 'Sent to customer for approval' : 'Preparation saved');
      qc.invalidateQueries({ queryKey: ['order', id] });
      navigate(`/seller/orders/${res.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Save failed'),
  });

  const phoneApprovalMut = useMutation({
    meta: { success: 'Phone agreement recorded', silentError: true },
    mutationFn: async () => {
      await api(`/orders/${id}/prepare`, {
        method: 'POST',
        body: JSON.stringify({
          items: lines,
          deliveryCharge,
          preparationNote: preparationNote || undefined,
          sendForApproval: true,
        }),
      });
      return api(`/orders/${id}/agree-phone`, {
        method: 'POST',
        body: JSON.stringify({ note: phoneApprovalNote.trim() }),
      });
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['order', id] });
      qc.invalidateQueries({ queryKey: ['seller-dashboard'] });
      navigate(`/seller/orders/${res.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not record phone agreement'),
  });

  if (isLoading || !order) return <Loading />;

  function updateLine(idx: number, patch: Partial<PrepLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  return (
    <Page
      title={`Prepare ${order.orderNumber}`}
      subtitle={`${order.customer?.name} · requested ${ghs(order.estimatedTotal)}`}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-slate-500">Requested</div>
          <div className="font-bold">{ghs(requestedTotal)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Prepared items</div>
          <div className="font-bold">{ghs(itemsTotal)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Grand total</div>
          <div className="font-bold text-brand-800">{ghs(grandTotal)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Difference</div>
          <div className={`font-bold ${diff > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
            {ghs(diff)}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        {lines.map((line, idx) => {
          const actual = lineTotal(line);
          const d = actual - Number(line.requestedAmount || 0);
          const pct = Number(line.requestedAmount)
            ? ((d / Number(line.requestedAmount)) * 100).toFixed(1)
            : '0';
          const priceChanged =
            Number(line.confirmedUnitPrice) !== Number(line.catalogueUnitPrice);

          return (
            <Card key={idx} className={line.isRemoved ? 'opacity-60' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {line.productNameSnapshot}
                    {line.variantNameSnapshot ? ` · ${line.variantNameSnapshot}` : ''}
                    {line.isReplacement ? ' (added)' : ''}
                  </div>
                  <div className="text-sm text-slate-500">
                    Requested {ghs(line.requestedAmount)} · Catalogue{' '}
                    {ghs(line.catalogueUnitPrice)}/{unitLabel(line.unitSnapshot)} · Est.{' '}
                    {line.estimatedQuantity} {unitLabel(line.unitSnapshot)}
                  </div>
                  {line.note && (
                    <div className="mt-1 text-xs text-slate-500">Customer note: {line.note}</div>
                  )}
                </div>
                <button
                  className="text-xs font-medium text-rose-600"
                  onClick={() => line.isRemoved ? updateLine(idx, { isRemoved: false }) : setRemoveIndex(idx)}
                >
                  {line.isRemoved ? 'Restore' : 'Remove item'}
                </button>
              </div>

              {!line.isRemoved && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input
                    label={
                      line.pricingTypeSnapshot === 'PER_MEASUREMENT'
                        ? `Actual weight (${unitLabel(line.unitSnapshot)})`
                        : `Actual units (${unitLabel(line.unitSnapshot)})`
                    }
                    type="number"
                    step="0.001"
                    min="0"
                    value={line.actualQuantity}
                    onChange={(e) => updateLine(idx, { actualQuantity: e.target.value })}
                  />
                  <Input
                    label="Confirmed unit price"
                    type="number"
                    step="0.01"
                    value={line.confirmedUnitPrice}
                    onChange={(e) => updateLine(idx, { confirmedUnitPrice: e.target.value })}
                  />
                  {(priceChanged || Math.abs(d) > 0.0001) && (
                    <div className="sm:col-span-2">
                      <Input
                        label="Reason for adjustment (required)"
                        value={line.priceChangeReason || ''}
                        onChange={(e) =>
                          updateLine(idx, { priceChangeReason: e.target.value })
                        }
                        placeholder="e.g. Available salmon piece weighs 1.2 kg"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span>Actual total: <strong>{ghs(actual)}</strong></span>
                <span>
                  Diff:{' '}
                  <strong className={d ? 'text-amber-700' : ''}>
                    {ghs(d)} ({pct}%)
                  </strong>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-4">
        <h3 className="font-semibold">Add replacement / extra item</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Input
            label="Name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
          <Input
            label="Line total (GH₵)"
            type="number"
            value={addAmount}
            onChange={(e) => setAddAmount(e.target.value)}
          />
          <div className="flex items-end">
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                if (!addName.trim() || !Number(addAmount)) return;
                setLines((prev) => [
                  ...prev,
                  {
                    productNameSnapshot: addName.trim(),
                    unitSnapshot: 'PIECE',
                    pricingTypeSnapshot: 'FIXED_UNIT',
                    catalogueUnitPrice: addAmount,
                    confirmedUnitPrice: addAmount,
                    requestedAmount: '0',
                    estimatedQuantity: '1',
                    actualQuantity: '1',
                    isRemoved: false,
                    isReplacement: true,
                  },
                ]);
                setAddName('');
                setAddAmount('');
              }}
            >
              Add item
            </Button>
          </div>
        </div>
      </Card>

      <div className="mt-4 space-y-3">
        <Input
          label="Delivery charge"
          type="number"
          step="0.01"
          value={deliveryCharge}
          onChange={(e) => setDeliveryCharge(e.target.value)}
        />
        <TextArea
          label="Preparation note"
          value={preparationNote}
          onChange={(e) => setPreparationNote(e.target.value)}
        />
      </div>

      {error && (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        <Button
          variant="secondary"
          disabled={saveMut.isPending}
          onClick={() => {
            setError('');
            saveMut.mutate(false);
          }}
        >
          Save progress
        </Button>
        <Button
          variant="secondary"
          disabled={saveMut.isPending || phoneApprovalMut.isPending}
          onClick={() => {
            setError('');
            setPhoneApprovalOpen(true);
          }}
        >
          Customer agreed by phone
        </Button>
        <Button
          disabled={saveMut.isPending}
          onClick={() => {
            setError('');
            setConfirmFinalize(true);
          }}
        >
          Send for approval / finalize
        </Button>
      </div>
      <p className="mt-2 text-center text-xs text-slate-500">
        Only an exact match finalizes automatically. Any difference requires customer approval.
      </p>

      <Dialog
        open={removeIndex !== null}
        onClose={() => setRemoveIndex(null)}
        title="Remove this item?"
        description="It will stay visible in the order history, but will not be included in the prepared total."
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setRemoveIndex(null)}>Keep item</Button><Button variant="danger" className="flex-1" onClick={() => { if (removeIndex !== null) updateLine(removeIndex, { isRemoved: true }); setRemoveIndex(null); }}>Remove item</Button></div>}
      >
        {removeIndex !== null && <div className="rounded-2xl bg-slate-50 p-4"><p className="font-semibold text-slate-950">{lines[removeIndex]?.productNameSnapshot}</p><p className="mt-1 text-sm text-slate-500">Customer requested {ghs(lines[removeIndex]?.requestedAmount || 0)}</p></div>}
      </Dialog>

      <Dialog
        open={phoneApprovalOpen}
        onClose={() => setPhoneApprovalOpen(false)}
        title="Record phone agreement"
        description="Use this after you have called the customer and they agreed to the prepared total."
        closeOnBackdrop={!phoneApprovalMut.isPending}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={phoneApprovalMut.isPending} onClick={() => setPhoneApprovalOpen(false)}>Cancel</Button><Button variant="success" className="flex-1" disabled={!phoneApprovalNote.trim() || phoneApprovalMut.isPending} onClick={() => { setError(''); phoneApprovalMut.mutate(); }}>{phoneApprovalMut.isPending ? 'Saving…' : 'Confirm and send'}</Button></div>}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex justify-between text-sm"><span className="text-slate-500">Customer requested</span><strong>{ghs(requestedTotal)}</strong></div>
            <div className="mt-2 flex justify-between text-sm"><span className="text-slate-500">Agreed prepared total</span><strong className="text-lg text-green-700">{ghs(grandTotal)}</strong></div>
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm"><span className="text-slate-500">Difference</span><strong className={diff ? 'text-amber-700' : 'text-slate-700'}>{diff > 0 ? '+' : ''}{ghs(diff)}</strong></div>
          </div>
          <TextArea label="Call note (required)" value={phoneApprovalNote} onChange={(e) => setPhoneApprovalNote(e.target.value)} placeholder={`Called ${order.customer?.name}; customer agreed to ${ghs(grandTotal)}.`} />
          <p className="text-sm leading-5 text-slate-500">Confirming will finalize the order and send the customer the agreed amount and payment link.</p>
        </div>
      </Dialog>

      <Dialog
        open={confirmFinalize}
        onClose={() => setConfirmFinalize(false)}
        title={Math.abs(diff) > 0.0001 ? 'Send for customer approval?' : 'Finalize prepared order?'}
        description="Review the totals before continuing. This creates a new order revision."
        closeOnBackdrop={!saveMut.isPending}
        footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" disabled={saveMut.isPending} onClick={() => setConfirmFinalize(false)}>Go back</Button><Button className="flex-1" disabled={saveMut.isPending} onClick={() => { setError(''); saveMut.mutate(true); }}>{saveMut.isPending ? 'Saving…' : Math.abs(diff) > 0.0001 ? 'Send for approval' : 'Finalize order'}</Button></div>}
      >
        <div className="space-y-3">
          <div className="flex justify-between text-sm"><span className="text-slate-500">Customer requested</span><strong>{ghs(requestedTotal)}</strong></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Prepared total</span><strong>{ghs(grandTotal)}</strong></div>
          <div className="flex justify-between border-t border-slate-100 pt-3"><span className="font-medium">Difference</span><strong className={diff ? 'text-amber-700' : 'text-emerald-700'}>{diff > 0 ? '+' : ''}{ghs(diff)}</strong></div>
        </div>
      </Dialog>
    </Page>
  );
}
