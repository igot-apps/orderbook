import { Pagination, type OrderPage } from '../../components/Pagination';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatWhen, ghs, orderStatusLabel } from '../../lib/format';
import { useDebouncedValue } from '../../lib/hooks';
import { Button, Card, Empty, ErrorBox, Input, Loading, Page, SkeletonList, StatusBadge } from '../../components/ui';

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'SUBMITTED', label: 'New' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'AWAITING_CUSTOMER_APPROVAL', label: 'Approval' },
  { value: 'CHANGE_REQUESTED', label: 'Changes' },
  { value: 'AGREED', label: 'Awaiting payment' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function SellerOrdersPage() {
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') || '';
  // Dashboard links sometimes combine statuses (DELIVERED,COMPLETED) — match the primary one.
  const status = statusParam.split(',')[0];
  const urlQ = params.get('q') || '';
  const [q, setQ] = useState(urlQ);
  const debouncedQ = useDebouncedValue(q, 350);
  useEffect(() => { setPage(1); }, [statusParam, debouncedQ]);
  const selectedStatus = STATUSES.find((item) => item.value === status);

  // Sync debounced input -> URL (single source of truth for the query).
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debouncedQ) next.set('q', debouncedQ);
    else next.delete('q');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  // Keep the box in sync when navigating back / clearing via chips.
  useEffect(() => {
    if (urlQ !== q) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const { data: result, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['seller-orders', statusParam, debouncedQ, page],
    queryFn: () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (statusParam) sp.set('status', statusParam);
      if (debouncedQ) sp.set('q', debouncedQ);
      return api<OrderPage>(`/orders?${sp}`);
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    placeholderData: (prev) => prev,
  });

  function clearFilters() {
    setQ('');
    setParams(new URLSearchParams(), { replace: true });
  }

  const searching = q !== debouncedQ;

  const data = result?.items;

  return (
    <Page
      title={
        statusParam === 'DELIVERED,COMPLETED' ? 'Completed requests'
          : statusParam.split(',').length > 2 ? 'In-progress requests'
          : status ? `${selectedStatus?.label || 'Filtered'} requests` : 'Requests'
      }
      subtitle={
        statusParam.split(',').length > 2
          ? 'Showing every request that is not yet delivered. Select one to open its details.'
          : statusParam.includes(',')
          ? 'Showing completed and delivered requests. Select one to open its details.'
          : status
            ? `Showing only ${selectedStatus?.label.toLowerCase() || 'matching'} requests. Select one to open its details and complete it.`
            : 'Select a request to open its details and complete it.'
      }
      actions={<div className="flex gap-2">
        {statusParam && <Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        <button type="button" className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? 'Refreshing…' : 'Refresh'}</button>
      </div>}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          label="Search requests"
          placeholder="Search request #, customer, phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s.value || 'all'}
            type="button"
            aria-pressed={status === s.value}
            className={`min-h-11 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              status === s.value
                ? 'bg-brand-700 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (s.value) next.set('status', s.value);
              else next.delete('status');
              setParams(next, { replace: true });
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-slate-500" aria-live="polite">
        {isFetching || searching ? 'Searching…' : data ? `${data.length} request${data.length === 1 ? '' : 's'} shown` : ''}
      </p>

      <div className="mt-2 space-y-3">
        {isLoading && !data ? (
          <SkeletonList rows={4} />
        ) : isError ? (
          <ErrorBox message="Could not load requests. Check your connection." onRetry={() => refetch()} />
        ) : !data?.length ? (
          <Empty
            title={statusParam || debouncedQ ? 'No requests match these filters' : 'No requests in this queue'}
            hint="New customer requests will appear here."
            action={(statusParam || debouncedQ) ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined}
          />
        ) : (
          data.map((o) => (
            <Card key={o.id} className="transition hover:border-brand-200">
              <Link to={`/seller/orders/${o.id}`} className="block" aria-label={`Open request ${o.orderNumber} from ${o.customer?.name}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {o.orderNumber} · {o.customer?.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {o.customer?.phone} · {formatWhen(o.createdAt)}
                    </div>
                  </div>
                  <StatusBadge status={o.status} label={orderStatusLabel(o.status, 'seller')} />
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-sm">
                  <span>Est. {ghs(o.estimatedTotal)}</span>
                  {o.agreedTotal && <span>Agreed {ghs(o.agreedTotal)}</span>}
                  {!o.agreedTotal ? (
                    <span className="rounded-lg bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                      {o.status === 'SUBMITTED'
                        ? 'New order request'
                        : o.status === 'PREPARING'
                          ? 'Preparation in progress'
                          : o.status === 'AWAITING_CUSTOMER_APPROVAL'
                            ? 'Awaiting customer approval'
                            : o.status === 'CHANGE_REQUESTED'
                              ? 'Customer requested changes'
                              : 'Pending finalization'}
                    </span>
                  ) : (
                    <span className={`rounded-lg px-2 py-1 font-semibold ${Number(o.outstandingBalance) > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {Number(o.outstandingBalance) > 0 ? 'Unpaid' : 'Paid'} · {ghs(o.outstandingBalance)}
                    </span>
                  )}
                </div>
              </Link>
              {(['SUBMITTED', 'PREPARING', 'CHANGE_REQUESTED', 'AWAITING_CUSTOMER_APPROVAL'].includes(o.status) || (o.status === 'AGREED' && Number(o.amountPaid) === 0)) && (
                <Link to={`/seller/orders/${o.id}?invoice=edit`} className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800">
                  {o.status === 'SUBMITTED' ? 'Prepare invoice' : 'Edit invoice'}
                </Link>
              )}
            </Card>
          ))
        )}
      </div>
      {isFetching && data && <div className="py-2 text-center text-xs text-slate-400"><Loading label="Updating…" /></div>}
      <Pagination page={page} hasMore={!!result?.hasMore} busy={isFetching} onChange={setPage} />
    </Page>
  );
}
