import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatWhen, ghs, orderStatusLabel } from '../../lib/format';
import { Button, Card, ErrorBox, Icon, Loading, Page, SkeletonList, StatusBadge } from '../../components/ui';

export function SellerDashboard() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['seller-dashboard'],
    queryFn: () => api<any>('/orders/dashboard/seller'),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  if (isLoading || !data) {
    return (
      <Page title="Shop dashboard"><SkeletonList rows={5} /></Page>
    );
  }
  if (isError) {
    return (
      <Page title="Shop dashboard">
        <ErrorBox message="Could not load the dashboard. Check your connection." onRetry={() => refetch()} />
      </Page>
    );
  }

  const c = data.counts || {};
  const completed = (c.DELIVERED || 0) + (c.COMPLETED || 0);

  const queues = [
    { status: 'SUBMITTED', label: 'New requests', count: c.SUBMITTED || 0, color: 'bg-indigo-100 text-indigo-700' },
    { status: 'COMPLETED', label: 'Completed', count: completed, color: 'bg-emerald-100 text-emerald-700' },
    { status: 'AWAITING_CUSTOMER_APPROVAL', label: 'Awaiting approval', count: c.AWAITING_CUSTOMER_APPROVAL || 0, color: 'bg-orange-100 text-orange-700' },
    { status: 'AGREED', label: 'Awaiting payment', count: c.AGREED || 0, color: 'bg-green-100 text-green-700' },
    { status: 'CHANGE_REQUESTED', label: 'Changes requested', count: c.CHANGE_REQUESTED || 0, color: 'bg-rose-100 text-rose-700' },
  ];

  return (
    <Page
      title="Shop dashboard"
      subtitle="Today's requests, money, and work in one place."
      actions={<div className="flex gap-2">
        <button type="button" className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
        <Link to="/seller/orders/new"><Button variant="success">New request</Button></Link>
      </div>}
    >
      <div>
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 to-blue-700 p-5 text-white shadow-lg shadow-indigo-900/10">
          <div className="absolute -right-10 -top-12 h-32 w-32 rounded-full border-[18px] border-white/5" aria-hidden="true" />
          <Link to="/seller/payments" className="relative block rounded-xl" aria-label={`Payments received today: ${ghs(data.paymentsTodayTotal)} from ${data.paymentsTodayCount || 0} payments. View receipts.`}>
            <p className="text-sm font-medium text-indigo-100">Payments received today</p>
            <p className="mt-1 text-3xl font-bold tracking-[-0.04em]">{ghs(data.paymentsTodayTotal)}</p>
            <p className="mt-1 text-sm text-indigo-100">From {data.paymentsTodayCount || 0} verified payment{data.paymentsTodayCount === 1 ? '' : 's'} · View receipts</p>
          </Link>
          <div className="relative mt-4 grid grid-cols-2 gap-3 border-t border-white/15 pt-4">
            <Link to="/seller/outstanding" className="rounded-xl bg-white/10 px-3 py-2.5 transition hover:bg-white/15" aria-label={`Total outstanding ${ghs(data.totalOutstanding)}. View balances.`}>
              <span className="block text-xs text-indigo-100">Total outstanding</span>
              <strong className="mt-0.5 block text-base text-amber-200">{ghs(data.totalOutstanding)}</strong>
            </Link>
            <Link to="/seller/orders?status=DELIVERED,COMPLETED" className="rounded-xl bg-white/10 px-3 py-2.5 transition hover:bg-white/15" aria-label={`${data.deliveredUnpaid || 0} completed but unpaid orders. View them.`}>
              <span className="block text-xs text-indigo-100">Completed unpaid</span>
              <strong className="mt-0.5 block text-base text-white">{data.deliveredUnpaid || 0} orders</strong>
            </Link>
          </div>
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-950">Request queues</h2><p className="mt-0.5 text-sm text-slate-500">Choose a queue to see its requests.</p></div><Link to="/seller/orders" className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">View all</Link></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {queues.map((queue) => <Link key={queue.status} to={`/seller/orders?status=${queue.status === 'COMPLETED' ? 'DELIVERED,COMPLETED' : queue.status}`} className="card p-4 transition hover:-translate-y-0.5 hover:shadow-md" aria-label={`${queue.label}: ${queue.count} requests`}><span className={`grid h-9 w-9 place-items-center rounded-xl ${queue.color}`}><Icon name="orders" className="h-4 w-4" /></span><strong className="mt-4 block text-2xl tracking-tight text-slate-950">{queue.count}</strong><span className="mt-1 block text-sm font-semibold text-slate-700">{queue.label}</span><span className="mt-2 block text-xs font-medium text-indigo-600">View requests</span></Link>)}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-950">Needs attention</h2><Link to="/seller/orders" className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">View all requests</Link></div>
        <div className="space-y-3">
          {(data.attention || []).map((o: any) => (
            <Link key={o.id} to={`/seller/orders/${o.id}`} aria-label={`Attention needed: order ${o.orderNumber} for ${o.customerName}`}>
              <Card className="transition hover:border-amber-200">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {o.orderNumber} · {o.customerName}
                    </div>
                    <div className="text-xs text-slate-500">{formatWhen(o.updatedAt)}</div>
                  </div>
                  <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'seller')} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span className="text-slate-600">{o.agreedTotal ? `Agreed ${ghs(o.agreedTotal)}` : `Estimated ${ghs(o.estimatedTotal)}`}</span>{Number(o.outstandingBalance) > 0 && <span className="rounded-lg bg-rose-50 px-2 py-1 font-semibold text-rose-600">Unpaid · {ghs(o.outstandingBalance)}</span>}</div>
              </Card>
            </Link>
          ))}
          {!data.attention?.length && (
            <Card>
              <p className="text-sm text-slate-500">All clear — nothing urgent.</p>
            </Card>
          )}
        </div>
      </section>

      {isFetching && <div className="py-3 text-center"><Loading label="Updating…" /></div>}
    </Page>
  );
}
