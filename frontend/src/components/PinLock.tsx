import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { phoneEmail, supabase } from '../lib/supabase';
import { toast } from '../lib/toast';

export const IDLE_LIMIT_MS = 5 * 60 * 1000;
const LAST_ACTIVE = 'op_last_active';
const LOCKED = 'op_locked';

/** Called after a password sign-in: the session starts unlocked. */
export function markUnlocked() {
  try {
    sessionStorage.setItem(LAST_ACTIVE, String(Date.now()));
    sessionStorage.removeItem(LOCKED);
  } catch { /* storage unavailable */ }
}

export function clearPinState() {
  try {
    sessionStorage.removeItem(LAST_ACTIVE);
    sessionStorage.removeItem(LOCKED);
  } catch { /* storage unavailable */ }
}

function idleTooLong() {
  const last = Number(sessionStorage.getItem(LAST_ACTIVE) || 0);
  return !last || Date.now() - last > IDLE_LIMIT_MS;
}

type Stage = 'loading' | 'create' | 'locked' | 'forgot' | 'open';

/** Required 6-digit app-lock PIN. Locks after 5 minutes without activity. */
export function PinGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [stage, setStage] = useState<Stage>('loading');

  const lock = useCallback(() => {
    sessionStorage.setItem(LOCKED, '1');
    setStage('locked');
  }, []);

  // Decide the starting screen for this signed-in user.
  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    setStage('loading');
    api<{ hasPin: boolean }>('/auth/pin')
      .then((r) => {
        if (cancelled) return;
        if (!r.hasPin) setStage('create');
        else if (sessionStorage.getItem(LOCKED) === '1' || idleTooLong()) lock();
        else setStage('open');
      })
      .catch(() => { if (!cancelled) lock(); });
    return () => { cancelled = true; };
  }, [user?.id, lock]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track activity and lock after 5 idle minutes.
  useEffect(() => {
    if (!supabase || !user || stage !== 'open') return;
    let lastWrite = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite > 5000) {
        lastWrite = now;
        sessionStorage.setItem(LAST_ACTIVE, String(now));
      }
    };
    const check = () => { if (idleTooLong()) lock(); };
    touch();
    const events = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 10000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [user?.id, stage, lock]); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = () => { markUnlocked(); setStage('open'); };
  const signOut = () => { clearPinState(); logout(); };

  if (!supabase || !user) return <>{children}</>;
  if (stage === 'open') return <>{children}</>;
  if (stage === 'loading') return <LockShell title="Loading…" subtitle="" />;
  if (stage === 'create') return <CreatePin endpoint="/auth/pin/set" title="Create your PIN" onDone={unlock} onSignOut={signOut} />;
  if (stage === 'forgot') return <ForgotPin phone={user.phone} onDone={unlock} onCancel={() => setStage('locked')} />;
  return <UnlockPin name={user.name} onUnlock={unlock} onForgot={() => setStage('forgot')} onSignOut={signOut} />;
}

function LockShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children?: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-[#f4f5f9] px-4 py-8 animate-fade" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-sm font-bold text-white">OB</div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        {children}
      </div>
      {footer && <div className="mt-4 flex flex-col items-center gap-2 text-sm">{footer}</div>}
    </div>
  );
}

function PinPad({ value, onChange, disabled, error }: { value: string; onChange: (v: string) => void; disabled?: boolean; error?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key) && value.length < 6) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, disabled]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <div className="mt-6">
      <div className={`flex justify-center gap-3 ${error ? 'animate-bump' : ''}`} aria-label={`${value.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${i < value.length ? 'border-brand-600 bg-brand-600' : 'border-slate-300'}`} />
        ))}
      </div>
      <p className="mt-3 min-h-5 text-sm font-medium text-red-600" role="alert">{error}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {keys.map((k, i) =>
          k === '' ? <span key={i} /> : (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-label={k === 'del' ? 'Delete digit' : k}
              onClick={() => onChange(k === 'del' ? value.slice(0, -1) : value.length < 6 ? value + k : value)}
              className="min-h-14 rounded-2xl bg-slate-100 text-xl font-semibold text-slate-900 hover:bg-slate-200 disabled:opacity-50"
            >
              {k === 'del' ? '⌫' : k}
            </button>
          )
        )}
      </div>
    </div>
  );
}

function CreatePin({ endpoint, title, onDone, onSignOut }: { endpoint: string; title: string; onDone: () => void; onSignOut?: () => void }) {
  const [first, setFirst] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirming = first.length === 6;

  const change = async (v: string) => {
    setError('');
    if (!confirming) {
      setPin(v);
      if (v.length === 6) { setFirst(v); setPin(''); }
      return;
    }
    setPin(v);
    if (v.length < 6) return;
    if (v !== first) {
      setError('PINs did not match. Try again.');
      setFirst(''); setPin('');
      return;
    }
    setBusy(true);
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify({ pin: v }) });
      toast.success('PIN saved');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your PIN');
      setFirst(''); setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockShell
      title={title}
      subtitle={confirming ? 'Enter the same 6 digits again to confirm.' : 'Choose a 6-digit PIN. You will need it to unlock OrderBook after 5 minutes without activity.'}
      footer={onSignOut && <button type="button" className="font-semibold text-slate-500 hover:text-slate-700" onClick={onSignOut}>Sign out</button>}
    >
      <PinPad value={pin} onChange={change} disabled={busy} error={error} />
    </LockShell>
  );
}

function UnlockPin({ name, onUnlock, onForgot, onSignOut }: { name: string; onUnlock: () => void; onForgot: () => void; onSignOut: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const change = async (v: string) => {
    setError('');
    setPin(v);
    if (v.length < 6) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; signOut?: boolean; attemptsLeft?: number }>('/auth/pin/verify', { method: 'POST', body: JSON.stringify({ pin: v }) });
      if (r.ok) { onUnlock(); return; }
      if (r.signOut) {
        toast.error('Too many wrong PINs. Sign in with your password.');
        onSignOut();
        return;
      }
      setError(`Wrong PIN. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left.`);
      setPin('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not check your PIN');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockShell
      title="OrderBook is locked"
      subtitle={`Welcome back${name ? `, ${name.split(' ')[0]}` : ''}. Enter your 6-digit PIN.`}
      footer={
        <>
          <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={onForgot}>Forgot PIN?</button>
          <button type="button" className="font-semibold text-slate-500 hover:text-slate-700" onClick={onSignOut}>Sign out</button>
        </>
      }
    >
      <PinPad value={pin} onChange={change} disabled={busy} error={error} />
    </LockShell>
  );
}

function ForgotPin({ phone, onDone, onCancel }: { phone: string; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

  if (verified) return <CreatePin endpoint="/auth/pin/reset" title="Set a new PIN" onDone={onDone} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: err } = await supabase!.auth.signInWithPassword({ email: phoneEmail(phone), password });
    setBusy(false);
    if (err) { setError('Incorrect password'); return; }
    setVerified(true);
  };

  return (
    <LockShell
      title="Reset your PIN"
      subtitle="Enter your account password to set a new PIN."
      footer={<button type="button" className="font-semibold text-slate-500 hover:text-slate-700" onClick={onCancel}>Back</button>}
    >
      <form onSubmit={submit} className="mt-6 space-y-3 text-left">
        <label className="block text-sm font-medium text-slate-700" htmlFor="pin-reset-password">Password</label>
        <input
          id="pin-reset-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input w-full"
          autoFocus
        />
        {error && <p className="text-sm font-medium text-red-600" role="alert">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !password}>{busy ? 'Checking…' : 'Continue'}</button>
      </form>
    </LockShell>
  );
}
