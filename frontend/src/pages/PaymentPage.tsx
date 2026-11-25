import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ghs } from '../lib/format';
import {
  Button,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  Input,
  Page,
  SkeletonList,
  SuccessScreen,
} from '../components/ui';

const NETWORKS = [
  { id: 'MTN', label: 'MTN MoMo', dot: 'bg-yellow-400' },
  { id: 'TELECEL', label: 'Telecel Cash', dot: 'bg-red-500' },
  { id: 'AT_MONEY', label: 'AT Money', dot: 'bg-blue-500' },
];

export function PaymentPage() {
  const { orderId } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'full' | 'partial'>('full');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState('');
  const [network, setNetwork] = useState('MTN');
  const [momoPhone, setMomoPhone] = useState(user?.phone || '');
  const [phoneError, setPhoneError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<any>(null);

  const isSeller = user?.role === 'SELLER';
  const orderPath = isSeller ? `/seller/orders/${orderId}` : `/customer/orders/${orderId}`;
  const receiptPath = (id: string) => (isSeller ? `/seller/receipts/${id}` : `/customer/receipts/${id}`);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pay', orderId],
    queryFn: () => api<any>(`/payments/order/${orderId}`),
  });

  const outstanding = Number(data?.outstandingBalance || 0);

  const initiate = useMutation({
    meta: { silentError: true },
    mutationFn: () => {
      const payAmount = mode === 'full' ? data.outstandingBalance : amount;
      return api('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          orderId,
          amount: payAmount,
          network,
          momoPhone: momoPhone.replace(/[\s-]/g, ''),
        }),
      });
    },
    onSuccess: (res) => {
      setReceipt(res);
      setError('');
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['pay', orderId] });
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: ['customer-dashboard'] });
      qc.invalidateQueries({ queryKey: ['seller-dashboard'] });
      refetch();
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : 'Payment failed to start. Check your connection and try again.');
      setConfirming(false);
    },
  });

  function validateAndConfirm() {
    setAmountError('');
    setPhoneError('');
    setError('');
    const cleanPhone = momoPhone.replace(/[\s-]/g, '');
    if (!/^(0\d{9}|\+233\d{9})$/.test(cleanPhone)) {
      setPhoneError('Enter a valid MoMo number, e.g. 0244123456.');
      return;
    }
    if (mode === 'partial') {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) {
        setAmountError('Enter an amount above GH₵0.');
        return;
      }
      if (n > outstanding + 0.001) {
        setAmountError(`Amount exceeds the outstanding balance of ${ghs(outstanding)}.`);
        return;
      }
    }
    setConfirming(true);
  }

  const payAmount = mode === 'full' ? outstanding : Number(amount || 0);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-lg px-4 py-6">
          <Page title="Mobile Money payment"><SkeletonList rows={3} /></Page>
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-lg px-4 py-6">
          <Page title="Mobile Money payment" backTo={orderPath} backLabel="Order">
            <ErrorBox message="Could not load payment details. Check your connection." onRetry={() => refetch()} />
          </Page>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-lg px-4 py-6">
        <Page
          title="Mobile Money payment"
          subtitle={`${data.businessName} · ${data.orderNumber}`}
          backTo={orderPath}
          backLabel="Order"
        >
          <Card>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Final total</div>
                <div className="text-lg font-bold">{ghs(data.finalTotal)}</div>
              </div>
              <div>
                <div className="text-slate-500">Already paid</div>
                <div className="text-lg font-bold">{ghs(data.amountPaid)}</div>
              </div>
              <div className="col-span-2 rounded-xl bg-amber-50 px-3 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Outstanding balance</div>
                <div className="text-2xl font-bold text-amber-900">
                  {ghs(data.outstandingBalance)}
                </div>
              </div>
            </div>
          </Card>

          <SuccessScreen
            open={!!receipt}
            title="Payment successful"
            message={receipt ? `${ghs(receipt.amount)} received. A receipt has been issued.` : undefined}
            primary={{ label: 'View receipt', onClick: () => receipt && navigate(receiptPath(receipt.id)) }}
            secondary={{ label: 'Back to order', onClick: () => navigate(orderPath) }}
          >
            {receipt && (
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt number</span>
                <strong className="mt-1 block text-xl text-slate-950">{receipt.receiptNumber}</strong>
              </div>
            )}
          </SuccessScreen>
          {receipt ? null : data.isPaid ? (
            <Card className="mt-4 border-emerald-200 bg-emerald-50">
              <div className="font-semibold text-emerald-900">This order is fully paid.</div>
              <Link
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline"
                to={orderPath}
              >
                Back to order
              </Link>
            </Card>
          ) : (
            <Card className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Payment type">
                <button
                  type="button"
                  aria-pressed={mode === 'full'}
                  className={`min-h-14 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    mode === 'full'
                      ? 'border-brand-600 bg-brand-50 text-brand-900'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                  onClick={() => { setMode('full'); setAmountError(''); }}
                >
                  Full payment
                  <div className="text-xs font-normal text-slate-500">
                    {ghs(data.outstandingBalance)}
                  </div>
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'partial'}
                  className={`min-h-14 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    mode === 'partial'
                      ? 'border-brand-600 bg-brand-50 text-brand-900'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                  onClick={() => setMode('partial')}
                >
                  Partial payment
                  <div className="text-xs font-normal text-slate-500">Pay any amount</div>
                </button>
              </div>

              {mode === 'partial' && (
                <div>
                  <Input
                    label={`Amount to pay (GH₵) — up to ${ghs(outstanding)}`}
                    type="number"
                    min="0.01"
                    max={outstanding}
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setAmountError(''); }}
                    aria-invalid={!!amountError}
                    aria-describedby={amountError ? 'pay-amount-error' : undefined}
                  />
                  {amountError && <p id="pay-amount-error" className="mt-1 text-xs font-medium text-rose-600">{amountError}</p>}
                </div>
              )}

              <div>
                <span className="label">Network</span>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Network">
                  {NETWORKS.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      role="radio"
                      aria-checked={network === n.id}
                      onClick={() => setNetwork(n.id)}
                      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-semibold transition active:scale-95 ${
                        network === n.id ? 'border-brand-600 bg-brand-50 text-brand-900 ring-2 ring-brand-100' : 'border-slate-200 bg-white text-slate-600'
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${n.dot}`} aria-hidden="true" />
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Input
                  label="Mobile Money number"
                  inputMode="tel"
                  placeholder="0244123456"
                  value={momoPhone}
                  onChange={(e) => { setMomoPhone(e.target.value); setPhoneError(''); }}
                  aria-invalid={!!phoneError}
                  aria-describedby={phoneError ? 'momo-error' : 'momo-hint'}
                />
                {phoneError
                  ? <p id="momo-error" className="mt-1 text-xs font-medium text-rose-600">{phoneError}</p>
                  : <p id="momo-hint" className="mt-1 text-xs text-slate-500">The prompt goes to this number — it can differ from your login number.</p>}
              </div>

              {error && <ErrorBox message={error} onRetry={() => { setError(''); }} />}

              <Button
                className="w-full !py-4 text-base"
                variant="success"
                disabled={initiate.isPending || !momoPhone.trim()}
                onClick={validateAndConfirm}
              >
                Continue · {ghs(mode === 'full' ? outstanding : Number(amount || 0))}
              </Button>
              <p className="text-center text-xs text-slate-500">
                A receipt is issued instantly after the network confirms.
              </p>
            </Card>
          )}

          {!!data.payments?.length && (
            <div className="mt-6">
              <h2 className="mb-2 font-semibold">Verified payments</h2>
              {data.payments.map((p: any) => (
                <Link key={p.id} to={receiptPath(p.id)} aria-label={`Receipt ${p.receiptNumber}, ${ghs(p.amount)}`}>
                  <Card className="mb-2 transition hover:border-brand-200">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{ghs(p.amount)}</span>
                      <span className="text-sm text-slate-500">{p.receiptNumber}</span>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
          <Dialog
            open={confirming}
            onClose={() => !initiate.isPending && setConfirming(false)}
            closeOnBackdrop={!initiate.isPending}
            title="Confirm payment"
            description={`You will get a prompt on ${momoPhone} to approve.`}
            footer={
              <Button variant="success" className="w-full !min-h-14 text-base" disabled={initiate.isPending} onClick={() => initiate.mutate()}>
                {initiate.isPending ? 'Processing…' : `Pay ${ghs(payAmount)}`}
              </Button>
            }
          >
            <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</div>
              <div className="mt-1 text-4xl font-extrabold tracking-[-0.03em] text-slate-950">{ghs(payAmount)}</div>
            </div>
            <dl className="mt-4 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between py-3"><dt className="text-slate-500">Network</dt><dd className="font-semibold">{NETWORKS.find((n) => n.id === network)?.label}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-slate-500">MoMo number</dt><dd className="font-semibold">{momoPhone}</dd></div>
              <div className="flex justify-between py-3"><dt className="text-slate-500">Order</dt><dd className="font-semibold">{data.orderNumber}</dd></div>
            </dl>
            {error && <div className="mt-3"><ErrorBox message={error} /></div>}
          </Dialog>
        </Page>
      </div>
    </div>
  );
}
