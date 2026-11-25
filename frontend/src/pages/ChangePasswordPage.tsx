import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { toast } from '../lib/toast';
import { Button, Card, Page } from '../components/ui';

/** More → Change password, for customers and sellers. The same password is used for every shop. */
export function ChangePasswordPage({ backTo }: { backTo: string }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      toast.success('Password changed');
      navigate(backTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Change password" subtitle="Your password is the same for every shop you use on OrderBook." backTo={backTo}>
      <Card>
        <form onSubmit={submit} className="space-y-3">
          <label className="block" htmlFor="chg-current">
            <span className="label">Current password</span>
            <input id="chg-current" type="password" autoComplete="current-password" className="input w-full" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          </label>
          <label className="block" htmlFor="chg-new">
            <span className="label">New password</span>
            <input id="chg-new" type="password" autoComplete="new-password" className="input w-full" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500">At least 8 characters.</p>
          <label className="block" htmlFor="chg-confirm">
            <span className="label">Confirm new password</span>
            <input id="chg-confirm" type="password" autoComplete="new-password" className="input w-full" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && <p className="text-sm font-medium text-red-600" role="alert">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !current || !next || !confirm}>{busy ? 'Saving…' : 'Change password'}</Button>
        </form>
      </Card>
    </Page>
  );
}
