import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatWhen, ghs, unitLabel } from '../lib/format';
import { Button, Card, Empty, ErrorBox, Page, SkeletonList } from '../components/ui';

export function ReceiptPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const isSeller = user?.role === 'SELLER';
  const backTo = isSeller ? '/seller/payments' : '/customer/payments';

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api<any>(`/payments/receipts/${id}`),
  });

  async function copyReceiptNo() {
    if (!data?.receiptNumber) return;
    try {
      await navigator.clipboard.writeText(data.receiptNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (isLoading) {
    return (
      <Page title="Digital receipt"><SkeletonList rows={3} /></Page>
    );
  }
  if (isError || !data) {
    return (
      <Page title="Digital receipt" backTo={backTo} backLabel="Payments">
        <ErrorBox message="Could not load this receipt." onRetry={() => refetch()} />
      </Page>
    );
  }

  return (
    <Page title="Digital receipt" subtitle={data.receiptNumber} backTo={backTo} backLabel="Payments">
      <Card className="!p-6">
        <div className="text-center">
          <div className="text-lg font-bold text-brand-800">{data.businessName}</div>
          <div className="mt-1 text-sm text-slate-500">Mobile Money receipt</div>
          <div className="mt-4 text-3xl font-bold tracking-tight">{ghs(data.amount)}</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <span aria-hidden="true">✓</span> Payment verified
          </div>
        </div>

        <div className="mt-6 space-y-2 border-t border-slate-100 pt-4 text-sm">
          <Row label="Receipt" value={data.receiptNumber} />
          <Row label="Order" value={data.orderNumber} />
          <Row label="Customer" value={`${data.customerName} · ${data.customerPhone}`} />
          <Row label="Network" value={data.network} />
          <Row label="MoMo number" value={data.momoPhone} />
          <Row label="Paid at" value={formatWhen(data.paidAt)} />
        </div>

        {!!data.items?.length && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="mb-2 text-sm font-semibold">Order items</div>
            {data.items.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between gap-2 border-b border-slate-50 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">
                    {item.name}
                    {item.variant ? ` · ${item.variant}` : ''}
                  </div>
                  <div className="text-xs text-slate-500">
                    {item.quantity} {unitLabel(item.unit)} × {ghs(item.unitPrice)}
                  </div>
                </div>
                <div className="shrink-0 font-medium">{ghs(item.lineTotal)}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-sm">
          <Row label="Order total" value={ghs(data.orderAgreedTotal)} />
          <Row label="Total paid" value={ghs(data.orderAmountPaid)} />
          <Row
            label="Outstanding"
            value={data.isOrderPaid ? 'GH₵0.00 (paid in full)' : ghs(data.orderOutstanding)}
          />
        </div>

        {data.isOrderPaid === false && data.orderOutstanding && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            Balance remaining: <strong>{ghs(data.orderOutstanding)}</strong> on this order.
          </p>
        )}
      </Card>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
          Print / save PDF
        </Button>
        <Button variant="secondary" className="flex-1" onClick={copyReceiptNo} aria-live="polite">
          {copied ? 'Copied ✓' : 'Copy receipt number'}
        </Button>
      </div>
      <Link to={backTo} className="mt-3 block text-center text-sm font-semibold text-brand-700">
        <span className="inline-flex min-h-11 items-center rounded-lg px-4 hover:bg-brand-50">Back to payments</span>
      </Link>

      {(!data.items || data.items.length === 0) && (
        <div className="mt-4">
          <Empty title="No item breakdown on this receipt" hint="The payment itself is verified above." />
        </div>
      )}
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}
