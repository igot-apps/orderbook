import { useState } from 'react';
import { Pagination, type OrderPage } from '../../components/Pagination';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatWhen, ghs, orderStatusLabel } from '../../lib/format';
import { Button, Card, Empty, Page, SkeletonList, StatusBadge } from '../../components/ui';

export function CustomerOrdersPage() {
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const filters = [
    { label: 'All', value: '' },
    { label: 'In progress', value: 'SUBMITTED,PREPARING,AWAITING_CUSTOMER_APPROVAL,CHANGE_REQUESTED,AGREED,READY_FOR_DELIVERY,DISPATCHED' },
    { label: 'Completed', value: 'DELIVERED,COMPLETED' },
  ];
  const { data: result, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['customer-orders', page, status],
    queryFn: () => api<OrderPage>('/orders?page=' + page + '&pageSize=25' + (status ? '&status=' + encodeURIComponent(status) : '')),
    refetchOnWindowFocus: 'always',
  });

  const data = result?.items;

  return (
    <Page
      title="My orders"
      subtitle="Track every request from submission to payment."
      actions={
        <div className="flex gap-2">
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn-secondary !min-h-11">
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/customer/orders/new"><Button>New order</Button></Link>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter orders">
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => { setPage(1); setParams(f.value ? { status: f.value } : {}, { replace: true }); }}
            className={`min-h-10 rounded-full px-4 text-sm font-semibold ${status === f.value ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : !data?.length ? (
        <Empty
          title="No orders yet"
          hint="Place your first order from the catalogue — it takes less than a minute."
          action={<Link to="/customer/catalogue"><Button>Browse catalogue</Button></Link>}
        />
      ) : (
        <div className="space-y-3">
          {data.map((o) => (
              <Card key={o.id}>
                <Link to={`/customer/orders/${o.id}`} className="block rounded-lg" aria-label={`Open order ${o.orderNumber}, ${orderStatusLabel(o.status, 'customer')}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{o.orderNumber}</div>
                    <div className="text-xs text-slate-500">{formatWhen(o.createdAt)}</div>
                  </div>
                  <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'customer')} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-slate-500">
                      Total
                    </div>
                    <div className="font-semibold">{ghs(o.agreedTotal ?? o.estimatedTotal)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-slate-500">Payment</div>
                    {!o.agreedTotal ? (
                      <div className="font-semibold text-amber-700">
                        {o.status === 'AWAITING_CUSTOMER_APPROVAL' ? 'Needs your approval' : 'Being prepared'}
                      </div>
                    ) : (
                      <div className={`font-bold ${Number(o.outstandingBalance) > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {Number(o.outstandingBalance) > 0 ? `Unpaid · ${ghs(o.outstandingBalance)}` : 'Paid'}
                      </div>
                    )}
                  </div>
                </div>
                </Link>
                {o.agreedTotal && Number(o.outstandingBalance) > 0 && ['AGREED', 'DELIVERED', 'COMPLETED'].includes(o.status) && (
                  <Link to={`/pay/${o.id}`} className="mt-4 block border-t border-rose-100 pt-3" aria-label={`Pay ${ghs(o.outstandingBalance)} for ${o.orderNumber}`}>
                    <Button variant="success" className="w-full">Pay now · {ghs(o.outstandingBalance)}</Button>
                  </Link>
                )}
              </Card>
          ))}
        </div>
      )}
      <Pagination page={page} hasMore={!!result?.hasMore} busy={isFetching} onChange={setPage} />
    </Page>
  );
}
