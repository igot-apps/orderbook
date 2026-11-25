import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { statusColor, statusLabel } from '../lib/format';
import { dismissToast, subscribeToasts, type ToastItem } from '../lib/toast';

export function Page({
  title,
  subtitle,
  actions,
  children,
  className,
  backTo,
  backLabel = 'Back',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  backTo?: string;
  backLabel?: string;
}) {
  return (
    <div className={clsx('animate-page mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-7 lg:px-8', className)}>
      {backTo && (
        <a
          href={import.meta.env.MODE === 'github' ? `${import.meta.env.BASE_URL}#${backTo}` : backTo}
          onClick={(e) => {
            // Prefer SPA navigation when possible but keep a working
            // plain link as fallback.
            e.preventDefault();
            if (window.history.length > 1) window.history.back();
            else window.location.assign(import.meta.env.MODE === 'github' ? `${import.meta.env.BASE_URL}#${backTo}` : backTo);
          }}
          className="-ml-2 mb-3 inline-flex min-h-10 items-center gap-0.5 rounded-full pl-1 pr-3 text-sm font-semibold text-brand-700 transition hover:bg-brand-50 active:scale-95"
          aria-label={backLabel}
        >
          <Icon name="back" className="h-5 w-5" /> {backLabel}
        </a>
      )}
      {(title || actions) && (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-slate-950 sm:text-3xl">{title}</h1>}
            {subtitle && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Card({
  children,
  className,
  onClick,
  label,
  role,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  label?: string;
  role?: string;
}) {
  return (
    <div
      className={clsx('card p-4 sm:p-5', onClick && 'cursor-pointer transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md', className)}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : role}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? label : undefined}
    >
      {children}
    </div>
  );
}

export function Button({
  variant = 'primary',
  type = 'button',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
}) {
  return (
    <button
      type={type}
      className={clsx(
        variant === 'primary' && 'btn-primary',
        variant === 'secondary' && 'btn-secondary',
        variant === 'success' && 'btn-success',
        variant === 'danger' && 'btn-danger',
        variant === 'ghost' && 'btn-ghost',
        className
      )}
      {...props}
    />
  );
}

export function Input({
  label,
  id,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const autoId = useRef(`input-${Math.random().toString(36).slice(2, 8)}`);
  const inputId = id || autoId.current;
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="label">{label}</span>}
      <input id={inputId} className={clsx('input', className)} {...props} />
    </label>
  );
}

export function TextArea({
  label,
  id,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const autoId = useRef(`ta-${Math.random().toString(36).slice(2, 8)}`);
  const inputId = id || autoId.current;
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="label">{label}</span>}
      <textarea id={inputId} className={clsx('input min-h-24', className)} {...props} />
    </label>
  );
}

export function Select({
  label,
  id,
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const autoId = useRef(`sel-${Math.random().toString(36).slice(2, 8)}`);
  const inputId = id || autoId.current;
  return (
    <label className="block" htmlFor={inputId}>
      {label && <span className="label">{label}</span>}
      <select id={inputId} className={clsx('input', className)} {...props}>
        {children}
      </select>
    </label>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={clsx('badge gap-1.5', statusColor(status))}><span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />{label || statusLabel(status)}</span>;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="animate-rise rounded-3xl bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand-50 text-brand-500" aria-hidden="true"><Icon name="inbox" className="h-8 w-8" /></div>
      <p className="mt-4 text-base font-bold text-slate-900">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-r-transparent" aria-hidden="true" />
      {label}
    </div>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading content">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card animate-pulse p-4">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
          <div className="mt-3 h-8 w-full rounded-xl bg-slate-100" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="animate-rise flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
      <span className="flex gap-2"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline underline-offset-2 hover:text-rose-900">
          Retry
        </button>
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      description={description}
      closeOnBackdrop={!busy}
      variant="alert"
      icon={
        <span className={clsx('grid h-14 w-14 place-items-center rounded-full', danger ? 'bg-rose-100 text-rose-600' : 'bg-brand-100 text-brand-700')}>
          <Icon name={danger ? 'alert' : 'question'} className="h-7 w-7" />
        </span>
      }
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} disabled={busy}>
            {busy ? 'Please wait…' : confirmLabel}
          </Button>
        </div>
      }
    />
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
  variant = 'sheet',
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
  /** sheet: slides up from the bottom on phones. alert: compact centred popup. */
  variant?: 'sheet' | 'alert';
  icon?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`).current;
  useModalBehaviour(open, panelRef, onClose);

  if (!open) return null;
  const alert = variant === 'alert';
  return createPortal(
    <div className={clsx('fixed inset-0 z-50 flex justify-center', alert ? 'items-center p-5' : 'items-end sm:items-center sm:p-4')} role="presentation">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        className="animate-fade absolute inset-0 cursor-default bg-slate-950/45 backdrop-blur-[3px]"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <section
        ref={panelRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative flex w-full flex-col overflow-hidden bg-white shadow-2xl outline-none',
          alert
            ? 'animate-pop-in max-w-sm rounded-3xl'
            : 'animate-sheet max-h-[92dvh] rounded-t-[28px] sm:max-w-lg sm:rounded-3xl sm:animate-pop-in'
        )}
      >
        {alert ? (
          <header className="flex flex-col items-center px-6 pt-7 text-center">
            {icon}
            <h2 id={titleId} className={clsx('text-lg font-bold tracking-[-0.02em] text-slate-950', icon && 'mt-4')}>{title}</h2>
            {description && <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>}
          </header>
        ) : (
          <>
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
            <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
              <div className="min-w-0">
                <h2 id={titleId} className="text-xl font-bold tracking-[-0.025em] text-slate-950">{title}</h2>
                {description && <p className="mt-1 text-sm leading-5 text-slate-500">{description}</p>}
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 active:scale-90">
                <Icon name="close" className="h-4 w-4" />
              </button>
            </header>
          </>
        )}
        {children && <div className={clsx('overflow-y-auto overscroll-contain', alert ? 'px-6 pt-3' : 'px-5 pb-5 pt-1 sm:px-6')}>{children}</div>}
        {footer && (
          <footer className={clsx('bg-white', alert ? 'px-6 pb-6 pt-5' : 'border-t border-slate-100 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6')}>{footer}</footer>
        )}
      </section>
    </div>,
    document.body
  );
}

/** Scroll lock, focus-in, Escape and a light focus trap — shared by every popup. */
function useModalBehaviour(open: boolean, panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const previouslyFocused = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>(
        'input, select, textarea, button:not([aria-label="Close"]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (el || panelRef.current)?.focus?.();
    }, 40);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', handleKey);
      window.clearTimeout(t);
      if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus?.();
    };
  }, [open, panelRef]);
}

/** iOS / Android style list of choices that slides up from the bottom. */
export function ActionSheet({
  open,
  onClose,
  title,
  subtitle,
  header,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  header?: ReactNode;
  actions: Array<{ label: string; hint?: string; icon?: IconName; onSelect: () => void; danger?: boolean }>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useModalBehaviour(open, panelRef, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" tabIndex={-1} aria-label="Close menu" className="animate-fade absolute inset-0 bg-slate-950/45 backdrop-blur-[3px]" onClick={onClose} />
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label={title || 'Menu'} tabIndex={-1} className="animate-sheet relative w-full max-w-lg px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none sm:animate-pop-in sm:px-0 sm:pb-0">
        <div className="overflow-hidden rounded-[28px] bg-white shadow-2xl">
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
          {header}
          {title && !header && (
            <div className="px-5 pb-2 pt-4 text-center">
              <div className="text-base font-bold text-slate-950">{title}</div>
              {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
            </div>
          )}
          <div className="p-2">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => { onClose(); a.onSelect(); }}
                className={clsx(
                  'flex min-h-14 w-full items-center gap-4 rounded-2xl px-3 text-left transition active:scale-[0.98]',
                  a.danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-800 hover:bg-slate-100'
                )}
              >
                {a.icon && (
                  <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-full', a.danger ? 'bg-rose-50' : 'bg-slate-100 text-slate-600')}>
                    <Icon name={a.icon} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{a.label}</span>
                  {a.hint && <span className="block truncate text-xs text-slate-500">{a.hint}</span>}
                </span>
                {!a.danger && <Icon name="chevron" className="h-4 w-4 text-slate-300" />}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={onClose} className="mt-2 min-h-14 w-full rounded-[22px] bg-white text-base font-bold text-brand-700 shadow-xl transition active:scale-[0.98] sm:hidden">
          Cancel
        </button>
      </section>
    </div>,
    document.body
  );
}

/** Full-screen celebration after a key action (order placed, payment made…). */
export function SuccessScreen({
  open,
  title,
  message,
  children,
  primary,
  secondary,
  tone = 'success',
}: {
  open: boolean;
  title: string;
  message?: string;
  children?: ReactNode;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  tone?: 'success' | 'info';
}) {
  const ref = useRef<HTMLElement>(null);
  useModalBehaviour(open, ref, secondary?.onClick || primary.onClick);
  if (!open) return null;
  return createPortal(
    <section ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="animate-fade fixed inset-0 z-[60] flex flex-col bg-white outline-none">
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
        <div className="relative">
          <span className={clsx('animate-ping-once absolute inset-0 rounded-full', tone === 'success' ? 'bg-green-200' : 'bg-brand-200')} aria-hidden="true" />
          <span className={clsx('animate-pop-in relative grid h-24 w-24 place-items-center rounded-full text-white shadow-xl', tone === 'success' ? 'bg-green-600 shadow-green-900/20' : 'bg-brand-600 shadow-brand-900/20')}>
            <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path className="animate-draw" d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
        </div>
        <h2 className="animate-rise mt-8 text-2xl font-bold tracking-[-0.03em] text-slate-950">{title}</h2>
        {message && <p className="animate-rise mx-auto mt-2 max-w-sm text-base leading-7 text-slate-600">{message}</p>}
        {children && <div className="animate-rise mt-6 w-full max-w-sm">{children}</div>}
      </div>
      <div className="mx-auto w-full max-w-sm space-y-2 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Button className="w-full !min-h-14 text-base" onClick={primary.onClick}>{primary.label}</Button>
        {secondary && <Button variant="ghost" className="w-full !min-h-12" onClick={secondary.onClick}>{secondary.label}</Button>}
      </div>
    </section>,
    document.body
  );
}

/** Renders the global toast stack. Mount once near the app root. */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]" aria-live="polite" role="status">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismissToast(t.id)}
          className="animate-toast pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-slate-900/95 px-4 py-3 text-left text-sm font-medium text-white shadow-2xl shadow-slate-900/30 backdrop-blur"
        >
          <span className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full', t.kind === 'success' ? 'bg-green-500' : t.kind === 'error' ? 'bg-rose-500' : 'bg-brand-500')}>
            <Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'alert' : 'info'} className="h-4 w-4" />
          </span>
          <span className="flex-1">{t.message}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'warn' | 'good' | 'brand' | 'info';
}) {
  const tones = {
    default: 'bg-white',
    warn: 'bg-amber-50 border-amber-100',
    good: 'bg-emerald-50 border-emerald-100',
    brand: 'bg-brand-50 border-brand-100',
    info: 'bg-blue-50 border-blue-100',
  };
  return (
    <div className={clsx('card p-4 sm:p-5', tones[tone])}>
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold tracking-[-0.025em] text-slate-950">{value}</div>
    </div>
  );
}

export type IconName = 'home' | 'shop' | 'cart' | 'plus' | 'orders' | 'more' | 'chart' | 'truck' | 'users' | 'tag' | 'card' | 'wallet' | 'report' | 'message' | 'settings' | 'logout' | 'search' | 'bell' | 'user' | 'chevron' | 'back' | 'close' | 'check' | 'alert' | 'info' | 'question' | 'inbox' | 'receipt' | 'trash' | 'edit' | 'star' | 'phone';

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/></>,
    shop: <><path d="M4 10v10h16V10"/><path d="M3 4h18l-2 6H5L3 4Z"/><path d="M8 14h8"/></>,
    cart: <><path d="M3 4h2l2.2 11.5h12.5L22 7H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    orders: <><path d="M5 4h14v17H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    truck: <><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/></>,
    users: <><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M16 4a4 4 0 0 1 0 8M17 15c3 .5 5 2.8 5 6"/></>,
    tag: <><path d="M3 11V4h7l11 11-7 7L3 11Z"/><circle cx="7.5" cy="8.5" r="1"/></>,
    card: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></>,
    wallet: <><path d="M3 6h16v14H3zM3 9h16M17 13h5v4h-5a2 2 0 0 1 0-4Z"/></>,
    report: <><path d="M5 3h14v18H5zM8 16l3-3 2 2 3-4"/></>,
    message: <><path d="M4 4h16v13H8l-4 4V4Z"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-2-2.2-2.2-2 .9-1.7-.7-.8-2h-3l-.7 2-1.7.7-2-.9L1 6.1l.9 2-.7 1.7-2 .7v3l2 .7.7 1.7-.9 2L3.2 20l2-.9 1.7.7.7 2h3l.7-2 1.7-.7 2 .9 2.2-2.2-.9-2 .7-1.7 2-.6Z" transform="translate(2) scale(.83)"/></>,
    logout: <><path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H8"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>,
    chevron: <><path d="m9 6 6 6-6 6"/></>,
    back: <><path d="m15 5-7 7 7 7"/></>,
    close: <><path d="M6 6l12 12M18 6 6 18"/></>,
    check: <><path d="m5 12.5 4.5 4.5L19 7.5"/></>,
    alert: <><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.5"/></>,
    question: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 17v.3"/></>,
    inbox: <><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6l2-8Z"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
    star: <><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z"/></>,
    phone: <><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={clsx('h-5 w-5', className)}>{paths[name]}</svg>;
}
