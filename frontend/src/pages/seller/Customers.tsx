import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { formatWhen, ghs } from '../../lib/format';
import { toast } from '../../lib/toast';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  Icon,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  TextArea,
} from '../../components/ui';

type TempLogin = { name: string; phone: string; temporaryPassword: string };

/** Shows a new temporary password once so the seller can pass it on privately. */
function TempPasswordDialog({ login, onClose }: { login: TempLogin | null; onClose: () => void }) {
  const text = login ? `OrderBook sign-in for ${login.name}\nPhone: ${login.phone}\nTemporary password: ${login.temporaryPassword}\nYou will be asked to choose your own password when you sign in.` : '';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Sign-in details copied');
    } catch {
      toast.error('Could not copy. Write the password down instead.');
    }
  };
  return (
    <Dialog
      open={!!login}
      onClose={onClose}
      title="Share these sign-in details"
      description="This temporary password is shown only once. The customer must change it when they first sign in."
      footer={<div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={copy}>Copy details</Button><Button className="flex-1" onClick={onClose}>Done</Button></div>}
    >
      {login && (
        <div className="space-y-3 rounded-2xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-3"><span className="text-slate-500">Customer</span><span className="font-semibold text-slate-900">{login.name}</span></div>
          <div className="flex justify-between gap-3"><span className="text-slate-500">Phone</span><span className="font-semibold text-slate-900">{login.phone}</span></div>
          <div className="flex items-center justify-between gap-3"><span className="text-slate-500">Temporary password</span><span className="rounded-lg bg-white px-3 py-1.5 font-mono text-lg font-bold tracking-widest text-slate-950">{login.temporaryPassword}</span></div>
        </div>
      )}
    </Dialog>
  );
}

export function SellerCustomersPage() {
  const [tempLogin, setTempLogin] = useState<TempLogin | null>(null);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api<any[]>('/customers'),
  });

  const createMut = useMutation({
    meta: { success: 'Customer added', silentError: true },
    mutationFn: () =>
      api('/customers', {
        method: 'POST',
        body: JSON.stringify({ name, phone, notes: notes || undefined }),
      }),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      if (created?.temporaryPassword) setTempLogin({ name: created.name, phone: created.phone, temporaryPassword: created.temporaryPassword });
      setOpen(false);
      setName('');
      setPhone('');
      setNotes('');
      setError('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMut.mutate();
  }

  return (
    <Page
      title="Customers"
      actions={
        <Button onClick={() => setOpen(true)}>
          <Icon name="plus" className="h-4 w-4" /> Add customer
        </Button>
      }
    >
      <Dialog open={open} onClose={() => setOpen(false)} title="Add customer" description="They can sign in with their phone number.">
          <form className="space-y-3" onSubmit={onSubmit}>
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {error && <ErrorBox message={error} />}
            <Button type="submit" disabled={createMut.isPending}>
              Create customer
            </Button>
            <p className="text-xs text-slate-500">A temporary password is created for them. You'll see it once to share privately.</p>
          </form>
      </Dialog>
      <TempPasswordDialog login={tempLogin} onClose={() => setTempLogin(null)} />

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="No customers" />
      ) : (
        <div className="space-y-3">
          {data.map((c) => (
            <Link key={c.id} to={`/seller/customers/${c.id}`}>
              <Card>
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-sm text-slate-500">{c.phone}</div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="font-semibold">{ghs(c.outstandingBalance)}</div>
                    <div className="text-slate-500">{c.orderCount} orders</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>{c.creditAllowed ? 'Credit allowed' : 'No credit'}</span>
                  <span>Recent: {formatWhen(c.recentActivity)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </Page>
  );
}

export function SellerCustomerDetailPage() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => api<any>(`/customers/${id}`),
    enabled: !!id,
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [tempLogin, setTempLogin] = useState<TempLogin | null>(null);
  const resetMut = useMutation({
    meta: { success: 'Temporary password created' },
    mutationFn: () => api<{ phone: string; temporaryPassword: string }>(`/customers/${id}/reset-password`, { method: 'POST', body: '{}' }),
    onSuccess: (r) => {
      setConfirmReset(false);
      setTempLogin({ name: data?.name || 'Customer', phone: r.phone, temporaryPassword: r.temporaryPassword });
    },
  });

  if (isLoading) return <Loading />;
  if (!data) return <Empty title="Customer not found" />;

  return (
    <Page title={data.name} subtitle={data.phone}>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-xs text-slate-500">Outstanding</div>
          <div className="text-xl font-bold">{ghs(data.outstandingBalance)}</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Credit</div>
          <div className="text-xl font-bold">
            {data.creditAllowed ? 'Allowed' : 'Not allowed'}
          </div>
        </Card>
      </div>
      {data.notes && <p className="mt-3 text-sm text-slate-600">{data.notes}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/seller/orders/new?customerId=${data.id}`}>
          <Button>Create order for customer</Button>
        </Link>
        <Button variant="secondary" onClick={() => setConfirmReset(true)}>Reset password</Button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => resetMut.mutate()}
        busy={resetMut.isPending}
        title="Create a new temporary password?"
        description={`${data.name}'s current password will stop working. They must choose a new password when they sign in.`}
        confirmLabel="Reset password"
      />
      <TempPasswordDialog login={tempLogin} onClose={() => setTempLogin(null)} />

      <h2 className="mb-2 mt-6 font-semibold">Recent orders</h2>
      <div className="space-y-2">
        {data.orders?.map((o: any) => (
          <Link key={o.id} to={`/seller/orders/${o.id}`}>
            <Card>
              <div className="flex justify-between">
                <span className="font-medium">{o.orderNumber}</span>
                <span className="text-sm">{o.status}</span>
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {o.agreedTotal ? ghs(o.agreedTotal) : ghs(o.estimatedTotal)} · Out{' '}
                {ghs(o.outstandingBalance)}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Page>
  );
}
