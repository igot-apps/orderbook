import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatWhen, ghs } from '../../lib/format';
import { PlaceOrderPage } from '../customer/PlaceOrder';
import {
  Button,
  Card,
  ConfirmDialog,
  Empty,
  Input,
  Loading,
  Page,
  StatusBadge,
} from '../../components/ui';

export function DeliveriesPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['delivery-orders'],
    queryFn: () => api<any[]>('/orders?status=AGREED,READY_FOR_DELIVERY,DISPATCHED'),
  });
  const [deliverId, setDeliverId] = useState<string | null>(null);
  const deliver = useMutation({
    meta: { success: 'Order marked completed' },
    mutationFn: (orderId: string) => api(`/orders/${orderId}/deliver`, { method: 'POST', body: JSON.stringify({ proofNote: 'Marked as completed by seller' }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['delivery-orders'] });
      qc.invalidateQueries({ queryKey: ['seller-dashboard'] });
    },
  });

  return (
    <Page title="Orders to complete" subtitle="Complete an order after the final amount is agreed and the order is fulfilled.">
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="No orders to complete" />
      ) : (
        <div className="space-y-3">
          {data.map((o) => (
              <Card key={o.id}>
                <Link to={`/seller/orders/${o.id}`} className="block">
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {o.orderNumber} · {o.customer?.name}
                    </div>
                    <div className="text-sm text-slate-500">
                      {o.deliveryInstructions || o.delivery?.instructions || 'No instructions'}
                    </div>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-2 text-sm">
                  {o.agreedTotal && ghs(o.agreedTotal)}
                </div>
                </Link>
                <Button variant="success" className="mt-4 w-full" disabled={deliver.isPending} onClick={() => setDeliverId(o.id)}>
                  {deliver.isPending ? 'Saving…' : 'Mark completed'}
                </Button>
              </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!deliverId}
        onClose={() => setDeliverId(null)}
        onConfirm={() => { if (deliverId) deliver.mutate(deliverId); setDeliverId(null); }}
        title="Mark this order completed?"
        description="The customer will see it as fulfilled. Only do this after the goods have been handed over."
        confirmLabel="Mark completed"
      />
    </Page>
  );
}

export function OutstandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['aging'],
    queryFn: () => api<any>('/customers/outstanding/aging'),
  });

  if (isLoading) return <Loading />;
  if (!data) return <Empty title="No data" />;

  const buckets = [
    ['0-7', '0–7 days'],
    ['8-14', '8–14 days'],
    ['15-30', '15–30 days'],
    ['30+', 'Over 30 days'],
  ] as const;

  return (
    <Page title="Outstanding balances" subtitle={`Total ${ghs(data.grandTotal)}`}>
      <div className="space-y-6">
        {buckets.map(([key, label]) => {
          const bucket = data.buckets[key];
          return (
            <section key={key}>
              <div className="mb-2 flex justify-between">
                <h2 className="font-semibold">{label}</h2>
                <span className="font-bold text-amber-800">{ghs(bucket.total)}</span>
              </div>
              {!bucket.items.length ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <div className="space-y-2">
                  {bucket.items.map((row: any) => (
                    <Link key={row.orderId} to={`/seller/orders/${row.orderId}`}>
                      <Card>
                        <div className="flex justify-between gap-2">
                          <div>
                            <div className="font-medium">
                              {row.orderNumber} · {row.customerName}
                            </div>
                            <div className="text-xs text-slate-500">
                              {row.daysOutstanding} days · {row.customerPhone}
                            </div>
                          </div>
                          <div className="font-semibold">{ghs(row.outstandingBalance)}</div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </Page>
  );
}

export function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<any>('/reports'),
  });

  if (isLoading || !data) return <Loading />;

  const rows = [
    ['Estimated order requests', data.estimatedOrderRequests],
    ['Agreed sales', data.agreedSales],
    ['Delivered sales', data.deliveredSales],
    ['Verified payments received', data.verifiedPaymentsReceived],
    ['Outstanding debts', data.outstandingDebts],
    ['Delivery charges', { count: '—', total: data.deliveryCharges.total }],
    ['Cancelled orders', data.cancelledOrders],
  ] as const;

  return (
    <Page title="Basic reports">
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(([label, row]) => (
          <Card key={label}>
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold">{ghs(row.total)}</div>
            <div className="text-xs text-slate-500">Count: {row.count}</div>
          </Card>
        ))}
      </div>
    </Page>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<any>('/reports/settings'),
  });
  const [delivery, setDelivery] = useState('');

  const save = useMutation({
    meta: { success: 'Settings saved' },
    mutationFn: () =>
      api('/reports/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          defaultDeliveryCharge: delivery || data.defaultDeliveryCharge,
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (isLoading || !data) return <Loading />;

  return (
    <Page title="Settings">
      <Card className="space-y-3 max-w-lg">
        <Input
          label="Default delivery charge"
          type="number"
          step="0.01"
          defaultValue={String(data.defaultDeliveryCharge)}
          onChange={(e) => setDelivery(e.target.value)}
        />
        <p className="text-sm text-slate-500">
          Any difference from the customer’s requested total requires explicit approval.
        </p>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </Card>
    </Page>
  );
}

export function SellerMorePage() {
  const { user } = useAuth();
  const isOwner = user?.staffRole !== 'STAFF';
  const { data: me } = useQuery({ queryKey: ['auth-me'], queryFn: () => api<{ isAdmin?: boolean }>('/auth/me'), staleTime: 10 * 60_000 });
  const links = [
    ['Outstanding', '/seller/outstanding'],
    ['Reports', '/seller/reports'],
    ...(isOwner ? [['Settings', '/seller/settings'], ['Online payments', '/seller/payouts'], ['Subscription', '/seller/billing'], ['Staff', '/seller/staff']] : []),
    ['Products', '/seller/products'],
    ['Payments', '/seller/payments'],
    ['My shops', '/seller/shops'],
    ['Send feedback', '/seller/feedback'],
    ...(me?.isAdmin ? [['OrderBook admin', '/seller/admin']] : []),
  ];
  return (
    <Page title="More">
      <div className="grid gap-2">
        {links.map(([label, to]) => (
          <Link key={to} to={to} className="card px-4 py-4 font-medium">
            {label}
          </Link>
        ))}
      </div>
    </Page>
  );
}

export function SellerCreateOrderPage() {
  return <PlaceOrderPage mode="seller" />;
}
