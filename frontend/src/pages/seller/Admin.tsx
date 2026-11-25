import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { formatWhen, ghs } from '../../lib/format';
import { toast } from '../../lib/toast';
import { Button, Card, ErrorBox, Input, Loading, Page } from '../../components/ui';

type SubState = { status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED'; activeUntil: string; daysLeft: number; suspended: boolean };
type Shop = {
  id: string;
  name: string;
  createdAt: string;
  owner?: { name: string; phone: string } | null;
  subscription: SubState;
  suspendReason?: string | null;
  orders: number;
  customers: number;
  lastOrderAt?: string | null;
  onlinePayments: boolean;
};
type Overview = {
  shops: number;
  byStatus: Record<string, number>;
  newShops30d: number;
  subscriptionTotal: string;
  orderPaymentsTotal: string;
  months: Array<{ month: string; subscriptions: string; subscriptionCount: number; orderPayments: string; orderPaymentCount: number; newShops: number }>;
};

const PILL: Record<string, string> = {
  TRIAL: 'bg-sky-50 text-sky-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  GRACE: 'bg-amber-50 text-amber-800',
  EXPIRED: 'bg-rose-50 text-rose-700',
  SUSPENDED: 'bg-slate-900 text-white',
};

function statusOf(s: SubState) {
  return s.suspended ? 'SUSPENDED' : s.status;
}

/** OrderBook operators only (PlatformAdmin): every shop, gift time, suspend, revenue. */
export function SellerAdminPage() {
  const [tab, setTab] = useState<'shops' | 'revenue' | 'feedback'>('shops');
  return (
    <Page title="OrderBook admin" subtitle="All shops on OrderBook." backTo="/seller/more">
      <div className="mb-4 flex gap-2">
        {(['shops', 'revenue', 'feedback'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${tab === t ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm'}`}>
            {t === 'shops' ? 'Shops' : t === 'revenue' ? 'Revenue' : 'Feedback'}
          </button>
        ))}
      </div>
      {tab === 'shops' ? <Shops /> : tab === 'revenue' ? <Revenue /> : <FeedbackList />}
    </Page>
  );
}

function Revenue() {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/admin/overview') });
  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorBox message={error instanceof ApiError ? error.message : 'Could not load.'} onRetry={() => refetch()} />;
  const tiles: Array<[string, string]> = [
    ['Shops', String(data.shops)],
    ['New shops (30 days)', String(data.newShops30d)],
    ['Subscriptions received', ghs(data.subscriptionTotal)],
    ['Order payments processed', ghs(data.orderPaymentsTotal)],
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-bold">{value}</div>
          </Card>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(data.byStatus).map(([k, v]) => (
          <span key={k} className={`rounded-full px-3 py-1 text-xs font-semibold ${PILL[k] || ''}`}>{k.toLowerCase()}: {v}</span>
        ))}
      </div>
      <h2 className="mb-2 mt-6 font-semibold">By month</h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="px-4 py-2">Month</th><th className="px-4 py-2">Subscriptions</th><th className="px-4 py-2">Order payments</th><th className="px-4 py-2">New shops</th></tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{m.month}</td>
                <td className="px-4 py-2">{ghs(m.subscriptions)} <span className="text-xs text-slate-500">({m.subscriptionCount})</span></td>
                <td className="px-4 py-2">{ghs(m.orderPayments)} <span className="text-xs text-slate-500">({m.orderPaymentCount})</span></td>
                <td className="px-4 py-2">{m.newShops}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Shops() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-shops', applied],
    queryFn: () => api<Shop[]>(`/admin/shops${applied ? `?search=${encodeURIComponent(applied)}` : ''}`),
  });
  return (
    <>
      <ResetPassword />
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); setApplied(search.trim()); }}>
        <div className="flex-1"><Input placeholder="Search shop name or owner phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {isLoading ? <Loading /> : isError || !data ? (
        <ErrorBox message={error instanceof ApiError ? error.message : 'Could not load shops.'} onRetry={() => refetch()} />
      ) : !data.length ? (
        <p className="text-sm text-slate-500">No shops found.</p>
      ) : (
        <div className="space-y-2">{data.map((s) => <ShopCard key={s.id} shop={s} />)}</div>
      )}
    </>
  );
}

function ShopCard({ shop }: { shop: Shop }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | 'gift' | 'suspend'>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = statusOf(shop.subscription);

  async function run(path: string, body: Record<string, unknown>, done: string) {
    setErr('');
    setBusy(true);
    try {
      await api(`/admin/shops/${encodeURIComponent(shop.id)}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      toast.success(done);
      setMode(null);
      setValue('');
      qc.invalidateQueries({ queryKey: ['admin-shops'] });
      qc.invalidateQueries({ queryKey: ['admin-overview'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{shop.name}</div>
          <div className="text-xs text-slate-500">{shop.owner ? `${shop.owner.name} · ${shop.owner.phone}` : 'No owner'} · joined {formatWhen(shop.createdAt)}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${PILL[st]}`}>{st.toLowerCase()}</span>
      </div>
      <div className="mt-2 text-xs text-slate-600">
        {shop.subscription.suspended
          ? `Suspended: ${shop.suspendReason || 'no reason given'}`
          : `${shop.subscription.status === 'TRIAL' ? 'Trial until' : 'Active until'} ${formatWhen(shop.subscription.activeUntil)}`}
        {' · '}{shop.orders} orders · {shop.customers} customers
        {shop.lastOrderAt ? ` · last order ${formatWhen(shop.lastOrderAt)}` : ''}
        {shop.onlinePayments ? ' · online payments on' : ''}
      </div>

      {mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setMode('gift'); setValue('30'); }}>Gift days</Button>
          {shop.subscription.suspended ? (
            <Button variant="secondary" disabled={busy} onClick={() => run('unsuspend', {}, 'Shop unsuspended')}>Unsuspend</Button>
          ) : (
            <Button variant="ghost" onClick={() => { setMode('suspend'); setValue(''); }}>Suspend</Button>
          )}
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'gift') run('gift', { days: value.trim() }, `${value} days added`);
            else run('suspend', { reason: value }, 'Shop suspended');
          }}>
          <div className="min-w-0 flex-1">
            <Input label={mode === 'gift' ? 'Days to add (1–366)' : 'Reason for suspending'} inputMode={mode === 'gift' ? 'numeric' : undefined}
              value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </div>
          <Button type="submit" variant={mode === 'suspend' ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Saving…' : mode === 'gift' ? 'Add days' : 'Suspend'}</Button>
          <Button type="button" variant="ghost" onClick={() => { setMode(null); setErr(''); }}>Cancel</Button>
        </form>
      )}
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
    </Card>
  );
}

type FeedbackItem = { id: string; message: string; page?: string | null; status: 'OPEN' | 'DONE'; createdAt: string; role?: string; name?: string; phone?: string; shop?: string | null };

function FeedbackList() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-feedback', status],
    queryFn: () => api<FeedbackItem[]>(`/admin/feedback?status=${status}`),
  });

  async function toggle(f: FeedbackItem) {
    setBusy(f.id);
    try {
      await api(`/admin/feedback/${encodeURIComponent(f.id)}/${f.status === 'OPEN' ? 'done' : 'reopen'}`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['admin-feedback'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mb-3 flex gap-2 text-sm">
        {(['OPEN', 'DONE'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 font-medium ${status === s ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-slate-600'}`}>
            {s === 'OPEN' ? 'Open' : 'Done'}
          </button>
        ))}
      </div>
      {isLoading ? <Loading /> : isError || !data ? (
        <ErrorBox message={error instanceof ApiError ? error.message : 'Could not load feedback.'} onRetry={() => refetch()} />
      ) : !data.length ? (
        <p className="text-sm text-slate-500">{status === 'OPEN' ? 'No open feedback.' : 'Nothing marked done yet.'}</p>
      ) : (
        <div className="space-y-2">
          {data.map((f) => (
            <Card key={f.id}>
              <p className="whitespace-pre-wrap text-sm text-slate-900">{f.message}</p>
              <div className="mt-2 text-xs text-slate-500">
                {[f.name, f.phone, f.role?.toLowerCase(), f.shop, f.page, formatWhen(f.createdAt)].filter(Boolean).join(' · ')}
              </div>
              <Button variant="secondary" className="mt-3" disabled={busy === f.id} onClick={() => toggle(f)}>
                {f.status === 'OPEN' ? 'Mark done' : 'Reopen'}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

/** Admin: set any account's password to 123456789; they must pick a new one at next sign-in. */
function ResetPassword() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ name: string; phone: string; shops: string[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Reset the password for ${phone.trim()} to 123456789?`)) return;
    setErr('');
    setDone(null);
    setBusy(true);
    try {
      const r = await api<{ name: string; phone: string; shops: string[] }>('/admin/reset-password', { method: 'POST', body: JSON.stringify({ phone }) });
      setDone(r);
      setPhone('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>Reset a password</Button>
      </div>
    );
  }
  return (
    <Card className="mb-4">
      <div className="font-semibold">Reset a password</div>
      <p className="mt-1 text-xs text-slate-500">Sets the password to 123456789. They must choose a new password when they next sign in.</p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit}>
        <div className="min-w-0 flex-1">
          <Input label="Phone number" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0241234567" />
        </div>
        <Button type="submit" disabled={busy || phone.trim().length < 9}>{busy ? 'Resetting…' : 'Reset'}</Button>
        <Button type="button" variant="ghost" onClick={() => { setOpen(false); setErr(''); setDone(null); }}>Close</Button>
      </form>
      {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
      {done && (
        <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Done. {done.name} ({done.phone}{done.shops.length ? ` · ${done.shops.join(', ')}` : ''}) can now sign in with <strong>123456789</strong> and will be asked to choose a new password.
        </p>
      )}
    </Card>
  );
}
