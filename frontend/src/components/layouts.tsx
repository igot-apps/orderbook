import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { api, type Membership } from '../lib/api';
import { toast } from '../lib/toast';
import { ActionSheet, ConfirmDialog, Icon, type IconName } from './ui';

function initialsOf(name?: string) {
  return (name || '?').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function Avatar({ name, size = 'md' }: { name?: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={clsx(
        'grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 font-bold text-white',
        size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs'
      )}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

/** Account button → action sheet → logout confirmation popup. */
function AccountSheet({ role, links }: { role: string; links: Array<{ to: string; label: string; hint: string; icon: IconName }> }) {
  const { user, logout, switchBusiness } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [shops, setShops] = useState<Membership[] | null>(null);

  const openShops = async () => {
    setOpen(false);
    try {
      setShops(await api<Membership[]>('/auth/businesses'));
    } catch {
      toast.error('Could not load your shops');
    }
  };
  const shopLabel = (m: Membership) =>
    m.role === 'CUSTOMER' ? 'Customer' : m.staffRole === 'STAFF' ? 'Staff' : 'Owner';

  return (
    <>
      <button type="button" aria-label="Account menu" onClick={() => setOpen(true)} className="grid h-11 w-11 place-items-center rounded-full transition hover:bg-slate-100 active:scale-90">
        <Avatar name={user?.name} />
      </button>
      <ActionSheet
        open={open}
        onClose={() => setOpen(false)}
        header={
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 pb-4 pt-4">
            <Avatar name={user?.name} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-lg font-bold text-slate-950">{user?.name}</div>
              <div className="text-sm text-slate-500">{user?.phone} · {role}</div>
              {user?.businessName && <div className="truncate text-sm font-medium text-brand-700">{user.businessName}</div>}
            </div>
          </div>
        }
        actions={[
          ...((user?.businessCount ?? 1) > 1
            ? [{ label: 'Switch shop', hint: 'Move to another shop on this account', icon: 'shop' as IconName, onSelect: openShops }]
            : []),
          ...links.map((l) => ({ label: l.label, hint: l.hint, icon: l.icon, onSelect: () => navigate(l.to) })),
          { label: 'Log out', icon: 'logout' as const, danger: true, onSelect: () => setConfirm(true) },
        ]}
      />
      <ActionSheet
        open={!!shops}
        onClose={() => setShops(null)}
        title="Switch shop"
        subtitle="Your PIN and password are the same in every shop."
        actions={(shops || []).map((m) => ({
          label: m.current ? `${m.businessName} (current)` : m.businessName,
          hint: shopLabel(m),
          icon: 'shop' as IconName,
          onSelect: () => {
            setShops(null);
            if (!m.current) switchBusiness(m.businessId).catch(() => toast.error('Could not switch shop'));
          },
        }))}
      />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          logout();
          navigate('/login', { replace: true });
        }}
        title="Log out?"
        description="You'll need your phone number and password to sign back in."
        confirmLabel="Log out"
        danger
      />
    </>
  );
}

function BrandMark() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white shadow-sm shadow-brand-900/20" aria-hidden="true">
      OB
    </span>
  );
}

function tabClass({ isActive }: { isActive: boolean }) {
  return clsx(
    'group flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors',
    isActive ? 'text-brand-700' : 'text-slate-500 hover:text-slate-800'
  );
}

function TabIcon({ icon, active }: { icon: IconName; active: boolean }) {
  return (
    <span className={clsx('grid h-8 w-14 place-items-center rounded-full transition-all duration-200', active ? 'bg-brand-100 scale-100' : 'scale-95 group-hover:bg-slate-100')}>
      <Icon name={icon} className="h-5 w-5" />
    </span>
  );
}

const customerAccountLinks = [
  { to: '/customer/profile', label: 'Profile & preferences', hint: 'Name, phone, auto-approval', icon: 'user' as const },
  { to: '/customer/notifications', label: 'Notifications', hint: 'Order updates and approvals', icon: 'bell' as const },
  { to: '/customer/payments', label: 'Payments & receipts', hint: 'Every payment you made', icon: 'receipt' as const },
];

export function CustomerLayout() {
  const { user } = useAuth();
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-2.5">
          <Link to="/customer" className="flex min-w-0 items-center gap-2.5" aria-label="OrderBook home">
            <BrandMark />
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight tracking-tight text-slate-950">OrderBook</span>
              <span className="block truncate text-xs text-slate-500">Hi, {firstName}</span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <NavLink
              to="/customer/notifications"
              aria-label="Notifications"
              className={({ isActive }) => clsx('grid h-11 w-11 place-items-center rounded-full transition active:scale-90', isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}
            >
              <Icon name="bell" className="h-[22px] w-[22px]" />
            </NavLink>
            <AccountSheet role="Customer" links={customerAccountLinks} />
          </div>
        </div>
      </header>
      <main className="safe-bottom mx-auto max-w-3xl pb-4">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200/70 bg-white/90 backdrop-blur-xl" aria-label="Customer navigation">
        <div className="mx-auto grid max-w-3xl grid-cols-4 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1">
          <NavLink to="/customer" end className={tabClass} aria-label="Home">
            {({ isActive }) => <><TabIcon icon="home" active={isActive} />Home</>}
          </NavLink>
          <NavLink to="/customer/catalogue" className={tabClass} aria-label="Shop">
            {({ isActive }) => <><TabIcon icon="shop" active={isActive} />Shop</>}
          </NavLink>
          <NavLink to="/customer/orders" className={tabClass} aria-label="My orders">
            {({ isActive }) => <><TabIcon icon="orders" active={isActive} />Orders</>}
          </NavLink>
          <NavLink to="/customer/more" className={tabClass} aria-label="More options">
            {({ isActive }) => <><TabIcon icon="more" active={isActive} />More</>}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

const sellerLinks = [
  { to: '/seller', label: 'Home', icon: 'home' as const, end: true },
  { to: '/seller/orders', label: 'Requests', icon: 'orders' as const },
  { to: '/seller/customers', label: 'Customers', icon: 'users' as const },
  { to: '/seller/products', label: 'Products', icon: 'tag' as const },
  { to: '/seller/payments', label: 'Payments', icon: 'card' as const },
  { to: '/seller/outstanding', label: 'Balances', icon: 'wallet' as const },
  { to: '/seller/reports', label: 'Reports', icon: 'report' as const },
  { to: '/seller/settings', label: 'Settings', icon: 'settings' as const },
];

// Mobile bottom nav: keep the highest-traffic seller destinations only.
const sellerMobileLinks = [
  sellerLinks[0], // Home
  sellerLinks[1], // Requests
  sellerLinks[2], // Customers (was Products — seller's daily job is people, not SKUs)
  sellerLinks[4], // Payments
];

const sellerAccountLinks = [
  { to: '/seller/products', label: 'Products', hint: 'Catalogue and prices', icon: 'tag' as const },
  { to: '/seller/outstanding', label: 'Balances', hint: 'Who still owes you', icon: 'wallet' as const },
  { to: '/seller/reports', label: 'Reports', hint: 'Sales and payments', icon: 'report' as const },
  { to: '/seller/settings', label: 'Settings', hint: 'Delivery charge and more', icon: 'settings' as const },
];

function sideClass({ isActive }: { isActive: boolean }) {
  return clsx(
    'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98]',
    isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
  );
}

type SubscriptionState = { status: 'TRIAL' | 'ACTIVE' | 'GRACE' | 'EXPIRED'; daysLeft: number; graceEndsAt: string };

/** Shown to sellers when the trial is nearly over, the shop is in its grace period, or it has expired. */
function SubscriptionBanner() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['billing-status', user?.businessId],
    queryFn: () => api<SubscriptionState>('/billing/status'),
    staleTime: 5 * 60_000,
  });
  if (!data || data.status === 'ACTIVE' || (data.status === 'TRIAL' && data.daysLeft > 7)) return null;
  const isOwner = user?.staffRole === 'OWNER';
  const graceDays = Math.max(0, Math.ceil((new Date(data.graceEndsAt).getTime() - Date.now()) / 86_400_000));
  const text =
    data.status === 'TRIAL'
      ? `Your free trial ends in ${data.daysLeft} day${data.daysLeft === 1 ? '' : 's'}.`
      : data.status === 'GRACE'
        ? `Your subscription has ended. New orders stop in ${graceDays} day${graceDays === 1 ? '' : 's'}.`
        : 'Your subscription has ended. The shop is read-only: no new orders or customers.';
  const urgent = data.status !== 'TRIAL';
  return (
    <div className={clsx('mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm md:mx-auto md:max-w-5xl', urgent ? 'bg-rose-50 text-rose-900' : 'bg-amber-50 text-amber-900')} role="status">
      <span className="font-medium">{text}</span>
      {isOwner ? (
        <Link to="/seller/billing" className="rounded-xl bg-white px-3 py-1.5 font-semibold shadow-sm">Renew now</Link>
      ) : (
        <span className="text-xs">Ask the shop owner to renew.</span>
      )}
    </div>
  );
}

export function SellerLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200/70 bg-white md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <div className="text-lg font-bold tracking-tight text-slate-950">OrderBook</div>
              <div className="text-xs text-slate-500">Seller workspace</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Seller navigation">
          {sellerLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={sideClass}>
              <Icon name={l.icon} />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-3">
          <button type="button" onClick={() => setConfirm(true)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-slate-50">
            <Avatar name={user?.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{user?.name}</span>
              <span className="block text-xs text-slate-500">Log out</span>
            </span>
            <Icon name="logout" className="h-4 w-4 text-slate-400" />
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/85 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <Link to="/seller" className="flex min-w-0 items-center gap-2.5">
              <BrandMark />
              <span className="min-w-0">
                <span className="block text-base font-bold leading-tight text-slate-950">OrderBook</span>
                <span className="block truncate text-xs text-slate-500">Seller · {user?.name}</span>
              </span>
            </Link>
            <AccountSheet role="Seller" links={sellerAccountLinks} />
          </div>
        </header>
        <main className="safe-bottom md:pb-8">
          <SubscriptionBanner />
          <Outlet />
        </main>
        <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200/70 bg-white/90 backdrop-blur-xl md:hidden" aria-label="Seller navigation">
          <div className="mx-auto grid max-w-3xl grid-cols-5 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1">
            {sellerMobileLinks.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={tabClass}>
                {({ isActive }) => <><TabIcon icon={l.icon} active={isActive} /><span className="truncate">{l.label}</span></>}
              </NavLink>
            ))}
            <NavLink to="/seller/more" className={tabClass}>
              {({ isActive }) => <><TabIcon icon="more" active={isActive} />More</>}
            </NavLink>
          </div>
        </nav>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          logout();
          navigate('/login', { replace: true });
        }}
        title="Log out?"
        description="You'll need your phone number and password to sign back in."
        confirmLabel="Log out"
        danger
      />
    </div>
  );
}
