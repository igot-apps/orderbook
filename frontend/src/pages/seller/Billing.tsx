import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { formatWhen, ghs } from '../../lib/format';
import { paystackAction, paystackReturnUrl } from '../../lib/payments';
import { toast } from '../../lib/toast';
import { Button, Card, ErrorBox, Loading, Page } from '../../components/ui';

type Billing = {
  status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED';
  activeUntil: string;
  daysLeft: number;
  plans: Array<{ months: number; label: string; amount: string; note?: string }>;
  history: Array<{ reference: string; months: number; amount: string; status: string; createdAt: string; paidAt?: string }>;
};

const STATUS_TEXT: Record<Billing['status'], string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  GRACE: 'Ended: grace period',
  EXPIRED: 'Ended: read-only',
};

/** Owner-only: OrderBook subscription (GH₵50/month or GH₵500/year), paid through Paystack. */
export function SellerBillingPage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const returnRef = searchParams.get('reference');
  const checked = useRef(false);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['billing'], queryFn: () => api<Billing>('/billing') });

  async function verify(reference: string) {
    setError('');
    setBusy(reference);
    try {
      const r = await paystackAction<{ status: string; message?: string }>({ action: 'subscription-verify', reference });
      if (r.status === 'success') toast.success('Subscription renewed. Thank you!');
      else setError(r.message ? `Payment not completed: ${r.message}` : 'The payment was not completed.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check the payment. Try again.');
    } finally {
      setBusy(null);
      qc.invalidateQueries();
    }
  }

  // Back from Paystack: confirm the payment on the server before extending the subscription.
  useEffect(() => {
    if (!returnRef || checked.current) return;
    checked.current = true;
    verify(returnRef).finally(() => setSearchParams({}, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnRef]);

  async function pay(months: number) {
    setError('');
    setBusy(months);
    try {
      const r = await paystackAction<{ authorizationUrl: string }>({ action: 'subscribe', months, returnUrl: paystackReturnUrl() });
      window.location.assign(r.authorizationUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the payment. Try again.');
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;
  if (isError || !data) return <Page title="Subscription"><ErrorBox message="Could not load your subscription." onRetry={() => refetch()} /></Page>;

  const ended = data.status === 'GRACE' || data.status === 'EXPIRED';
  return (
    <Page title="Subscription" subtitle="OrderBook for your shop: orders, invoices, customers, staff and Mobile Money payments." backTo="/seller/more">
      <Card className={ended ? 'border-rose-200 bg-rose-50' : undefined}>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</div>
        <div className="mt-1 text-2xl font-bold text-slate-950">{STATUS_TEXT[data.status]}</div>
        <p className="mt-1 text-sm text-slate-600">
          {ended
            ? `Ended ${formatWhen(data.activeUntil)}. Renew to take new orders and add customers again.`
            : `${data.status === 'TRIAL' ? 'Trial ends' : 'Paid until'} ${formatWhen(data.activeUntil)} · ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'} left`}
        </p>
      </Card>

      <h2 className="mb-2 mt-6 font-semibold">{data.status === 'ACTIVE' ? 'Add more time' : 'Choose a plan'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.plans.map((p) => (
          <Card key={p.months}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-semibold">{p.label}</div>
              {p.note && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{p.note}</span>}
            </div>
            <div className="mt-1 text-2xl font-bold">{ghs(p.amount)}<span className="text-sm font-normal text-slate-500"> / {p.months === 1 ? 'month' : 'year'}</span></div>
            <Button className="mt-3 w-full" disabled={busy !== null} onClick={() => pay(p.months)}>
              {busy === p.months ? 'Opening Paystack…' : `Pay ${ghs(p.amount)}`}
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Pay with Mobile Money or card through Paystack. New time is added after your current period ends.</p>
      {error && <div className="mt-3"><ErrorBox message={error} /></div>}

      {!!data.history.length && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Payments</h2>
          <div className="space-y-2">
            {data.history.map((h) => (
              <Card key={h.reference}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{ghs(h.amount)} · {h.months === 1 ? '1 month' : '12 months'}</div>
                    <div className="text-xs text-slate-500">{formatWhen(h.paidAt || h.createdAt)} · {h.status === 'SUCCESS' ? 'Paid' : h.status === 'FAILED' ? 'Not completed' : 'Waiting for confirmation'}</div>
                  </div>
                  {h.status === 'PENDING' && (
                    <Button variant="secondary" disabled={busy !== null} onClick={() => verify(h.reference)}>
                      {busy === h.reference ? 'Checking…' : 'Check status'}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
