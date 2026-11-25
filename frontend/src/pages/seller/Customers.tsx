import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { formatWhen, ghs } from '../../lib/format';
import {
  Button,
  Card,
  Dialog,
  Icon,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  TextArea,
} from '../../components/ui';

export function SellerCustomersPage() {
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
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
            <p className="text-xs text-slate-500">Share the customer's sign-in details privately.</p>
          </form>
      </Dialog>

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

      <div className="mt-4">
        <Link to={`/seller/orders/new?customerId=${data.id}`}>
          <Button>Create order for customer</Button>
        </Link>
      </div>

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
