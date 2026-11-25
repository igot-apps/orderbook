import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatWhen, ghs } from '../../lib/format';
import { useConfirmAction } from '../../lib/hooks';
import { Button, Card, ConfirmDialog, Empty, ErrorBox, Loading, Page, SkeletonList } from '../../components/ui';

export function CustomerMorePage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const confirmLogout = useConfirmAction(() => {
    logout();
    navigate('/login', { replace: true });
  });

  const rows = [
    { to: '/customer/notifications', title: 'Notifications', hint: 'Order updates and approvals' },
    { to: '/customer/payments', title: 'Payment history', hint: 'Every payment and receipt' },
    { to: '/customer/profile', title: 'Profile & preferences', hint: 'Name, phone, auto-approval' },
    { to: '/customer/feedback', title: 'Send feedback', hint: 'Tell us what to improve' },
  ];

  return (
    <Page title="More">
      <div className="grid gap-2">
        {rows.map((r) => (
          <Link key={r.to} to={r.to} className="card flex min-h-14 items-center justify-between gap-3 px-4 py-4 transition hover:border-brand-200 hover:shadow-sm" aria-label={r.title}>
            <span>
              <span className="block font-semibold text-slate-900">{r.title}</span>
              <span className="block text-xs text-slate-500">{r.hint}</span>
            </span>
            <span className="text-lg text-slate-300" aria-hidden="true">›</span>
          </Link>
        ))}
        <button
          type="button"
          onClick={confirmLogout.request}
          className="card flex min-h-14 items-center justify-between gap-3 px-4 py-4 text-left font-semibold text-rose-700 transition hover:border-rose-200 hover:bg-rose-50"
        >
          Log out
          <span className="text-lg text-rose-300" aria-hidden="true">›</span>
        </button>
      </div>
      <Card className="mt-6">
        <div className="text-sm text-slate-500">Signed in as</div>
        <div className="font-semibold">{user?.name}</div>
        <div className="text-sm text-slate-600">{user?.phone}</div>
      </Card>
      <ConfirmDialog
        open={confirmLogout.open}
        onClose={confirmLogout.cancel}
        onConfirm={confirmLogout.confirm}
        busy={confirmLogout.busy}
        title="Log out?"
        description="You'll need your phone number and password to sign back in."
        confirmLabel="Log out"
        danger
      />
    </Page>
  );
}

export function CustomerNotificationsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-notifications'],
    queryFn: () => api<any[]>('/notifications/me'),
  });

  return (
    <Page title="Notifications" backTo="/customer/more" backLabel="More">
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : isError ? (
        <ErrorBox message="Could not load notifications. Check your connection." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Empty title="No notifications" hint="Order updates and approval requests will appear here." />
      ) : (
        <div className="space-y-3">
          {data.map((n) => (
            <Card key={n.id}>
              <div className="text-xs font-semibold uppercase text-brand-700">{String(n.type).replaceAll('_', ' ')}</div>
              <p className="mt-1 text-sm leading-6">{n.message}</p>
              <div className="mt-2 text-xs text-slate-500">{formatWhen(n.createdAt)}</div>
              {n.linkPath && (
                <Link to={n.linkPath} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 hover:underline">
                  Open →
                </Link>
              )}
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

export function CustomerPaymentsPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-payments'],
    queryFn: () => api<any[]>('/payments/history/me'),
  });

  return (
    <Page title="Payment history" backTo="/customer/more" backLabel="More">
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : isError ? (
        <ErrorBox message="Could not load payments. Check your connection." onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Empty
          title="No payments yet"
          hint="Once you pay for an order, the receipt appears here."
          action={<Link to="/customer/orders"><Button variant="secondary">View orders</Button></Link>}
        />
      ) : (
        <div className="space-y-2">
          {data.map((p) => (
            <Link key={p.id} to={`/customer/receipts/${p.id}`} aria-label={`Receipt ${p.receiptNumber}, ${ghs(p.amount)}`}>
              <Card className="transition hover:border-brand-200">
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{ghs(p.amount)}</div>
                    <div className="truncate text-sm text-slate-500">{p.orderNumber}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <div>{p.receiptNumber}</div>
                    <div>{formatWhen(p.paidAt)}</div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function CustomerProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const preferences = useQuery({
    queryKey: ['customer-preferences'],
    queryFn: () => api<{ autoApproveUnchanged: boolean }>('/customers/me/preferences'),
  });
  const updatePreference = useMutation({
    meta: { success: 'Preference saved' },
    mutationFn: (autoApproveUnchanged: boolean) => api<{ autoApproveUnchanged: boolean }>('/customers/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ autoApproveUnchanged }),
    }),
    onSuccess: (data) => qc.setQueryData(['customer-preferences'], data),
  });
  const autoApprove = preferences.data?.autoApproveUnchanged ?? true;

  return (
    <Page title="Profile" backTo="/customer/more" backLabel="More">
      <Card>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-slate-500">Name</div>
            <div className="font-semibold">{user?.name}</div>
          </div>
          <div>
            <div className="text-slate-500">Phone</div>
            <div className="font-semibold">{user?.phone}</div>
          </div>
        </div>
        <p className="mt-4 text-xs leading-5 text-slate-500">
          Contact the shop if your account details need updating.
        </p>
      </Card>
      <Card className="mt-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-semibold text-slate-950">Auto-approve unchanged orders</div>
            <p className="mt-1 text-sm leading-5 text-slate-500">
              When the shop keeps every item and the total exactly as requested, it can complete the order without asking you again. Any quantity or price change will still need your approval.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoApprove}
            aria-label="Auto-approve unchanged orders"
            disabled={preferences.isLoading || updatePreference.isPending}
            onClick={() => updatePreference.mutate(!autoApprove)}
            className={`relative mt-0.5 h-11 w-16 shrink-0 rounded-full p-1 transition ${autoApprove ? 'bg-emerald-600' : 'bg-slate-300'}`}
          >
            <span className={`block h-9 w-9 rounded-full bg-white shadow-sm transition-transform ${autoApprove ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
        <div className={`mt-3 min-h-5 text-sm font-semibold ${autoApprove ? 'text-emerald-700' : 'text-slate-600'}`} aria-live="polite">
          {updatePreference.isPending ? 'Saving…' : autoApprove ? 'On — unchanged orders are approved automatically' : 'Off — every order needs your approval'}
        </div>
        {preferences.isError && <div className="mt-2"><ErrorBox message="Could not load your preference." onRetry={() => preferences.refetch()} /></div>}
        {updatePreference.isError && <div className="mt-2"><Loading label="" /></div>}
      </Card>
    </Page>
  );
}
