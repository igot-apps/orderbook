import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, Card, ErrorBox, Input } from '../components/ui';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const normalizedPhone = phone.replace(/[\s-]/g, '');
    if (!/^(0\d{9}|\+233\d{9})$/.test(normalizedPhone)) {
      setError('Enter a valid Ghanaian phone number, e.g. 0240000000.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setLoading(true);
    try {
      const user = await login(normalizedPhone, password);
      navigate(user.role === 'SELLER' ? '/seller' : '/customer', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6f2] lg:grid lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-white lg:flex lg:flex-col lg:justify-between" aria-hidden="true">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-white/10" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-brand-700/50 blur-3xl" />
        <div className="relative flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-sm font-black text-brand-900">OB</div><span className="text-xl font-bold tracking-tight">OrderBook</span></div>
        <div className="relative max-w-xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-brand-300">Order with confidence</p>
          <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-0.04em]">From your request to the final payment, everything stays clear.</h1>
          <div className="mt-10 grid grid-cols-3 gap-5 border-t border-white/15 pt-6 text-sm text-brand-100"><div><strong className="block text-2xl text-white">01</strong>Request by value</div><div><strong className="block text-2xl text-white">02</strong>Approve actuals</div><div><strong className="block text-2xl text-white">03</strong>Pay securely</div></div>
        </div>
        <p className="relative text-sm text-brand-200">Every order. Every payment. On record.</p>
      </section>

      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mb-8 lg:hidden"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-800 text-xs font-black text-white">OB</div><span className="text-xl font-bold tracking-tight text-slate-950">OrderBook</span></div></div>
        <div className="mb-7">
          <p className="text-sm font-semibold text-brand-700">Welcome back</p>
          <h1 className="mt-1 text-3xl font-bold tracking-[-0.035em] text-slate-950">Sign in to continue</h1>
          <p className="mt-2 text-base text-slate-500">Enter your Ghanaian phone number and password.</p>
        </div>

        <Card className="!p-5 shadow-xl shadow-slate-900/5 sm:!p-7">
          <form className="space-y-4" onSubmit={onSubmit} noValidate={false}>
            <Input
              label="Phone number"
              inputMode="tel"
              placeholder="0240000000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoComplete="tel"
              aria-describedby="phone-hint"
            />
            <p id="phone-hint" className=" -mt-2 text-xs text-slate-500">Use the 10-digit number you registered with, e.g. 0244123456.</p>
            <div>
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="mt-1.5 min-h-11 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide password' : 'Show password'}
              </button>
            </div>
            {error && <ErrorBox message={error} />}
            <Button type="submit" className="w-full !py-4 text-base" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            New here? <Link to="/login" onClick={(e) => e.preventDefault()} className="font-semibold text-brand-700" title="Ask the shop to create your account">Ask the shop to create your account</Link> — accounts are created by the seller.
          </p>
        </Card>
      </div>
    </div>
  );
}
