import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { ghs, formatWhen, orderStatusLabel } from '../../lib/format';
import { Button, Card, Empty, ErrorBox, Icon, Page, SkeletonList, StatusBadge } from '../../components/ui';

type Dash = {
  customer: { name: string };
  outstandingBalance: string;
  needingApproval: any[];
  activeOrders: any[];
  recentOrders: any[];
  summary?: { totalOrders: number; activeCount: number; completedCount: number; unpaidCount: number; unpaidTotal: string };
  unpaidOrders?: any[];
};

export function CustomerDashboard() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['customer-dashboard'],
    queryFn: () => api<Dash>('/orders/dashboard/customer'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  if (isLoading) {
    return (
      <Page title="Home">
        <SkeletonList rows={4} />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page title="Home">
        <ErrorBox
          message="Could not load your dashboard. Check your connection and try again."
          onRetry={() => refetch()}
        />
        <div className="mt-4">
          <Empty
            title="Nothing to show right now"
            hint="Your orders will appear here once you're back online."
            action={<Button variant="secondary" onClick={() => refetch()}>Retry</Button>}
          />
        </div>
      </Page>
    );
  }

  const initials = data.customer.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  const hasBalance = Number(data.outstandingBalance) > 0;
  const summary = data.summary;
  const unpaid = data.unpaidOrders || [];
  const unpaidCount = summary?.unpaidCount ?? unpaid.length;
  const unpaidTotal = summary?.unpaidTotal ?? data.outstandingBalance;

  return (
    <Page>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="min-w-0"><p className="text-sm text-slate-500">Good to see you</p><h1 className="truncate text-2xl font-bold tracking-[-0.03em] text-slate-950">{data.customer.name}</h1></div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-900" aria-hidden="true">{initials}</div>
      </div>

      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-700 to-indigo-900 p-5 text-white shadow-xl shadow-indigo-900/15 sm:p-7" aria-label="Balance summary">
        <div className="absolute -right-12 -top-14 h-40 w-40 rounded-full border-[24px] border-white/5" aria-hidden="true" />
        <p className="relative text-sm text-indigo-200">Outstanding balance</p>
        <p className="relative mt-1 text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{ghs(data.outstandingBalance)}</p>
        <p className="relative mt-1 text-xs text-indigo-200">{hasBalance ? 'Pay below to clear it. Receipts are issued instantly.' : 'All clear — no payment due.'}</p>
        <div className="relative mt-5 flex flex-col gap-2 sm:flex-row sm:gap-3">
          <Link to="/customer/orders/new" className="flex-1">
            <Button variant="success" className="w-full !py-3.5">Place an order</Button>
          </Link>
          {hasBalance && (
            <Link to="/customer/payments" className="flex-1">
              <Button className="w-full border border-white/20 !bg-white/10 !py-3.5 hover:!bg-white/20">View & pay balance</Button>
            </Link>
          )}
        </div>
      </section>

      <section className="mt-6" aria-label="Quick actions">
        <h2 className="mb-3 text-lg font-bold text-slate-950">Your dashboard</h2>
        <div className="grid grid-cols-2 gap-3">
          <a
            href="#unpaid-orders"
            onClick={(e) => { e.preventDefault(); document.getElementById('unpaid-orders')?.scrollIntoView({ behavior: 'smooth' }); }}
            className={`card group p-4 transition hover:-translate-y-0.5 hover:shadow-md ${unpaidCount ? 'border-rose-200 bg-rose-50/50 hover:border-rose-300' : 'hover:border-emerald-200'}`}
            aria-label={`${unpaidCount} unpaid orders, ${ghs(unpaidTotal)} to pay`}
          >
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${unpaidCount ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}><Icon name="card" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">Unpaid orders</span>
            <span className={`mt-1 block text-2xl font-bold tracking-tight ${unpaidCount ? 'text-rose-600' : 'text-emerald-600'}`}>{unpaidCount}</span>
            <span className="mt-1 block text-xs text-slate-500">{unpaidCount ? `${ghs(unpaidTotal)} to pay` : 'Nothing to pay'}</span>
          </a>
          <Link to="/customer/orders?status=DELIVERED,COMPLETED" className="card group p-4 transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md" aria-label={`${summary?.completedCount ?? 0} completed orders`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Icon name="orders" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">Completed</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight text-emerald-700">{summary?.completedCount ?? 0}</span>
            <span className="mt-1 block text-xs text-slate-500">Delivered orders</span>
          </Link>
          <Link to="/customer/orders" className="card group p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md" aria-label={`All my orders, ${summary?.totalOrders ?? 0} in total`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><Icon name="orders" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">All my orders</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight text-indigo-700">{summary?.totalOrders ?? data.activeOrders.length}</span>
            <span className="mt-1 block text-xs text-slate-500">{summary ? `${summary.activeCount} in progress` : 'View every order'}</span>
          </Link>
          <Link to={data.needingApproval[0] ? `/customer/orders/${data.needingApproval[0].id}/approve` : '/customer/orders'} className="card group p-4 transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md" aria-label={`${data.needingApproval.length} orders need approval`}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-100 text-orange-700"><Icon name="bell" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">Needs approval</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight text-orange-600">{data.needingApproval.length}</span>
            <span className="mt-1 block text-xs text-slate-500">Review price changes</span>
          </Link>
          <Link to="/customer/payments" className="card group p-4 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-100 text-blue-700"><Icon name="card" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">My payments</span>
            <span className="mt-1 block text-xs text-slate-500">History and receipts</span>
          </Link>
          <Link to="/customer/catalogue" className="card group p-4 transition hover:-translate-y-0.5 hover:border-green-200 hover:shadow-md">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-green-100 text-green-700"><Icon name="shop" /></span>
            <span className="mt-4 block text-sm font-semibold text-slate-950">Shop</span>
            <span className="mt-1 block text-xs text-slate-500">Browse products and prices</span>
          </Link>
        </div>
      </section>

      <section id="unpaid-orders" className="mt-6 scroll-mt-20" aria-label="Unpaid orders">
        <h2 className="mb-3 text-base font-bold text-slate-950">Unpaid orders ({unpaidCount})</h2>
        {unpaid.length === 0 ? (
          <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">You have no unpaid orders.</p>
        ) : (
          <div className="space-y-2">
            {unpaid.map((o) => (
              <Card key={o.id} className="border-rose-200">
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/customer/orders/${o.id}`} className="min-w-0">
                    <div className="font-semibold">{o.orderNumber}</div>
                    <div className="text-xs text-slate-500">{orderStatusLabel(o.status, 'customer')} · {formatWhen(o.createdAt)}</div>
                  </Link>
                  <Link to={`/pay/${o.id}`} className="shrink-0" aria-label={`Pay ${ghs(o.outstandingBalance)} for order ${o.orderNumber}`}>
                    <Button variant="success" className="!min-h-10 !px-4">Pay {ghs(o.outstandingBalance)}</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {data.needingApproval.length > 0 && (
        <section className="mt-6" aria-label="Orders awaiting approval">
          <h2 className="mb-3 text-base font-bold text-slate-950">Ready for your review ({data.needingApproval.length})</h2>
          <div className="space-y-3">
            {data.needingApproval.map((o) => (
              <Link key={o.id} to={`/customer/orders/${o.id}/approve`} aria-label={`Review changes for order ${o.orderNumber}`}>
                <Card className="border-amber-200 bg-amber-50/60">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{o.orderNumber}</div>
                      <div className="text-sm text-slate-600">
                        The shop updated your order — please review
                      </div>
                    </div>
                    <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'customer')} />
                  </div>
                  <div className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Review changes</div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Active orders
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => refetch()} disabled={isFetching} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <Link to="/customer/orders" className="rounded-lg px-2 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50">
              See all
            </Link>
          </div>
        </div>
        {data.activeOrders.length === 0 ? (
          <Empty
            title="No active orders"
            hint="Place an order from the catalogue."
            action={<Link to="/customer/catalogue"><Button variant="secondary">Browse catalogue</Button></Link>}
          />
        ) : (
          <div className="space-y-3">
            {data.activeOrders.map((o) => (
                <Card key={o.id}>
                  <Link to={`/customer/orders/${o.id}`} className="block rounded-lg" aria-label={`Open order ${o.orderNumber}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{o.orderNumber}</div>
                      <div className="text-xs text-slate-500">{formatWhen(o.createdAt)}</div>
                    </div>
                    <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'customer')} />
                  </div>
                  <div className="mt-2 flex justify-between text-sm">
                    <span className="text-slate-500">
                      Total
                    </span>
                    <span className={`font-bold ${Number(o.outstandingBalance) > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                      {ghs(o.agreedTotal ?? o.estimatedTotal)}
                    </span>
                  </div>
                  </Link>
                  {o.agreedTotal && Number(o.outstandingBalance) > 0 && ['AGREED', 'DELIVERED', 'COMPLETED'].includes(o.status) && (
                    <Link to={`/pay/${o.id}`} className="mt-3 block border-t border-rose-100 pt-3" aria-label={`Pay ${ghs(o.outstandingBalance)} for order ${o.orderNumber}`}>
                      <Button variant="success" className="w-full">Pay now · {ghs(o.outstandingBalance)}</Button>
                    </Link>
                  )}
                </Card>
            ))}
          </div>
        )}
      </section>

      {data.recentOrders?.length > 0 && (
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent
        </h2>
        <div className="space-y-2">
          {data.recentOrders.map((o) => (
            <Link
              key={o.id}
              to={`/customer/orders/${o.id}`}
              className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-slate-100 bg-white px-4 py-3 transition hover:border-brand-200"
              aria-label={`Open recent order ${o.orderNumber}`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{o.orderNumber}</div>
                <div className="text-xs text-slate-500">{formatWhen(o.createdAt)}</div>
              </div>
              <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'customer')} />
            </Link>
          ))}
        </div>
      </section>
      )}
    </Page>
  );
}
