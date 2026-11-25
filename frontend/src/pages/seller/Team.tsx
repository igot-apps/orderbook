import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Membership } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { toast } from '../../lib/toast';
import { Button, Card, ConfirmDialog, Dialog, Empty, ErrorBox, Icon, Input, Loading, Page } from '../../components/ui';
import { TempPasswordDialog, type TempLogin } from './Customers';

type StaffMember = { id: string; name: string; phone: string; staffRole: 'OWNER' | 'STAFF'; isActive: boolean; isMe: boolean };
type StaffAction = { member: StaffMember; action: 'deactivate' | 'activate' | 'reset-password' };

const actionText: Record<StaffAction['action'], { title: string; body: (n: string) => string; label: string }> = {
  deactivate: { title: 'Remove access?', body: (n) => `${n} will be signed out of this shop and can't use it until you turn access back on.`, label: 'Remove access' },
  activate: { title: 'Restore access?', body: (n) => `${n} will be able to use this shop again.`, label: 'Restore access' },
  'reset-password': { title: 'Create a new temporary password?', body: (n) => `${n}'s current password will stop working. They must choose a new one when they sign in.`, label: 'Reset password' },
};

/** Owner-only: people who help run this shop. */
export function SellerStaffPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [tempLogin, setTempLogin] = useState<TempLogin | null>(null);
  const [pending, setPending] = useState<StaffAction | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: () => api<StaffMember[]>('/staff') });

  const addMut = useMutation({
    meta: { success: 'Staff member added', silentError: true },
    mutationFn: () => api<any>('/staff', { method: 'POST', body: JSON.stringify({ name, phone }) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      if (r.temporaryPassword) setTempLogin({ name: r.name, phone: r.phone, temporaryPassword: r.temporaryPassword });
      else if (r.existingAccount) toast.info(`${r.name} already uses OrderBook. They sign in with their own password and switch to this shop.`);
      setOpen(false);
      setName('');
      setPhone('');
      setError('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const actMut = useMutation({
    mutationFn: (a: StaffAction) => api<any>(`/staff/${a.member.id}/${a.action}`, { method: 'POST', body: '{}' }),
    onSuccess: (r, a) => {
      setPending(null);
      qc.invalidateQueries({ queryKey: ['staff'] });
      if (a.action === 'reset-password') setTempLogin({ name: a.member.name, phone: r.phone, temporaryPassword: r.temporaryPassword });
      else toast.success(a.action === 'activate' ? 'Access restored' : 'Access removed');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addMut.mutate();
  };

  return (
    <Page
      title="Staff"
      subtitle="People who help run this shop. Staff can't change settings or manage staff."
      backTo="/seller/more"
      actions={<Button onClick={() => setOpen(true)}><Icon name="plus" className="h-4 w-4" /> Add staff</Button>}
    >
      <Dialog open={open} onClose={() => setOpen(false)} title="Add staff" description="They sign in with their phone number.">
        <form className="space-y-3" onSubmit={submit}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
          {error && <ErrorBox message={error} />}
          <Button type="submit" disabled={addMut.isPending}>Add staff member</Button>
          <p className="text-xs text-slate-500">New people get a temporary password you'll see once.</p>
        </form>
      </Dialog>
      <TempPasswordDialog login={tempLogin} onClose={() => setTempLogin(null)} />
      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={() => pending && actMut.mutate(pending)}
        busy={actMut.isPending}
        title={pending ? actionText[pending.action].title : ''}
        description={pending ? actionText[pending.action].body(pending.member.name) : ''}
        confirmLabel={pending ? actionText[pending.action].label : ''}
        danger={pending?.action === 'deactivate'}
      />

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="No staff yet" />
      ) : (
        <div className="space-y-3">
          {data.map((m) => (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{m.name}{m.isMe && ' (you)'}</div>
                  <div className="text-sm text-slate-500">{m.phone}</div>
                </div>
                <span className={m.staffRole === 'OWNER' ? 'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold bg-brand-50 text-brand-700' : m.isActive ? 'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700' : 'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-500'}>
                  {m.staffRole === 'OWNER' ? 'Owner' : m.isActive ? 'Staff' : 'No access'}
                </span>
              </div>
              {m.staffRole === 'STAFF' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.isActive ? (
                    <>
                      <Button variant="secondary" onClick={() => setPending({ member: m, action: 'reset-password' })}>Reset password</Button>
                      <Button variant="ghost" onClick={() => setPending({ member: m, action: 'deactivate' })}>Remove access</Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => setPending({ member: m, action: 'activate' })}>Restore access</Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/** Every shop on this account, plus opening a new one (owners only). */
export function SellerShopsPage() {
  const { user, switchBusiness } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['my-businesses'], queryFn: () => api<Membership[]>('/auth/businesses') });

  const createMut = useMutation({
    meta: { silentError: true },
    mutationFn: () => api<{ businessId: string; businessName: string }>('/businesses', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: (r) => {
      toast.success(`${r.businessName} is ready`);
      switchBusiness(r.businessId).catch(() => toast.error('Shop created. Switch to it from the account menu.'));
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const isOwner = user?.staffRole === 'OWNER';
  const roleLabel = (m: Membership) => (m.role === 'CUSTOMER' ? 'Customer' : m.staffRole === 'STAFF' ? 'Staff' : 'Owner');

  return (
    <Page
      title="My shops"
      subtitle="One sign-in for every shop. Your PIN and password are the same in all of them."
      backTo="/seller/more"
      actions={isOwner ? <Button onClick={() => setOpen(true)}><Icon name="plus" className="h-4 w-4" /> Open a shop</Button> : undefined}
    >
      <Dialog open={open} onClose={() => setOpen(false)} title="Open another shop" description="It starts empty: its own products, customers, orders and staff.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }}>
          <Input label="Shop name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          {error && <ErrorBox message={error} />}
          <Button type="submit" disabled={createMut.isPending}>Create shop</Button>
        </form>
      </Dialog>

      {isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {(data || []).map((m) => (
            <Card key={m.businessId}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{m.businessName}</div>
                  <div className="text-sm text-slate-500">{roleLabel(m)}</div>
                </div>
                {m.current ? (
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold bg-brand-50 text-brand-700">Current</span>
                ) : (
                  <Button variant="secondary" onClick={() => switchBusiness(m.businessId).catch(() => toast.error('Could not switch shop'))}>Switch</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}
