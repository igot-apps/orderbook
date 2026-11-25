import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { paystackAction } from '../../lib/payments';
import { toast } from '../../lib/toast';
import { Button, Card, ErrorBox, Input, Loading, Page } from '../../components/ui';

type Payout = { configured: boolean; settlementName?: string; accountNumber?: string; accountName?: string; updatedAt?: string };
type Provider = { name: string; code: string };

/** Guesses the MoMo network from a Ghanaian number's prefix, matched against Paystack's provider names. */
function guessProvider(phone: string, providers: Provider[]) {
  const local = phone.replace(/\D/g, '').replace(/^233/, '0');
  const prefix = local.slice(0, 3);
  const network = ['024', '025', '053', '054', '055', '059'].includes(prefix) ? /mtn/i
    : ['020', '050'].includes(prefix) ? /telecel|vodafone/i
    : ['026', '027', '056', '057'].includes(prefix) ? /airtel|tigo|\bat\b/i
    : null;
  return network ? providers.find((p) => network.test(p.name))?.code || '' : '';
}

/** Owner-only: where Paystack pays this shop's customer payments. */
export function SellerPayoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [bank, setBank] = useState('');
  // The owner's login phone is the default payout number; they can change it.
  const [number, setNumber] = useState(user?.phone || '');
  const [name, setName] = useState(user?.name || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const payout = useQuery({ queryKey: ['payout'], queryFn: () => api<Payout>('/payments/payout') });
  const showForm = editing || payout.data?.configured === false;
  const providers = useQuery({
    queryKey: ['momo-providers'],
    queryFn: () => paystackAction<Provider[]>({ action: 'banks' }),
    enabled: showForm,
    staleTime: 60 * 60_000,
  });

  useEffect(() => {
    if (!bank && providers.data?.length && number) setBank(guessProvider(number, providers.data));
  }, [providers.data, number, bank]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    const clean = number.replace(/[\s-]/g, '');
    if (!bank) return setError('Choose your Mobile Money provider.');
    if (!/^(0\d{9}|\+233\d{9})$/.test(clean)) return setError('Enter a valid MoMo number, e.g. 0244123456.');
    setSaving(true);
    try {
      await paystackAction({ action: 'save-payout', settlementBank: bank, accountNumber: clean, accountName: name });
      toast.success('Payout details saved');
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['payout'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page title="Online payments" subtitle="Customers pay with Mobile Money through Paystack. The money goes straight to your shop." backTo="/seller/more">
      {payout.isLoading ? (
        <Loading />
      ) : payout.isError ? (
        <ErrorBox message="Could not load payout details." onRetry={() => payout.refetch()} />
      ) : (
        <div className="space-y-4">
          {payout.data?.configured && (
            <Card>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Online payments are on</div>
              <dl className="mt-3 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Paid to</dt><dd className="font-semibold">{payout.data.settlementName}</dd></div>
                <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Number</dt><dd className="font-mono font-semibold">{payout.data.accountNumber}</dd></div>
                {payout.data.accountName && <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Name</dt><dd className="font-semibold">{payout.data.accountName}</dd></div>}
              </dl>
              {!editing && <Button variant="secondary" className="mt-3" onClick={() => setEditing(true)}>Change payout number</Button>}
            </Card>
          )}

          {showForm && (
            <Card>
              <form className="space-y-3" onSubmit={save}>
                <h2 className="font-semibold">{payout.data?.configured ? 'New payout number' : 'Where should we pay you?'}</h2>
                <label className="block">
                  <span className="label">Mobile Money provider</span>
                  <select className="input" value={bank} onChange={(e) => setBank(e.target.value)} disabled={providers.isLoading}>
                    <option value="">{providers.isLoading ? 'Loading providers…' : 'Choose provider'}</option>
                    {(providers.data || []).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </label>
                {providers.isError && <ErrorBox message={(providers.error as Error).message} onRetry={() => providers.refetch()} />}
                <Input label="MoMo number" inputMode="tel" placeholder="0244123456" value={number} onChange={(e) => setNumber(e.target.value)} required />
                <Input label="Name on the MoMo account" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                {error && <ErrorBox message={error} />}
                <div className="flex gap-2">
                  {payout.data?.configured && <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>}
                  <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Saving…' : 'Save payout details'}</Button>
                </div>
                <p className="text-xs text-slate-500">Paystack checks these details and sends each payment to this number, minus its fees.</p>
              </form>
            </Card>
          )}
        </div>
      )}
    </Page>
  );
}
