import { useEffect, useState } from 'react';

/** Debounce a fast-changing value (e.g. search input) to avoid a request per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const SESSION_EVENT = 'op-session-state';

/** Persist state to sessionStorage so a refresh / navigation doesn't wipe user progress. */
export function useSessionState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) return JSON.parse(raw) as T;
    } catch {
      /* ignore corrupt storage */
    }
    return initial;
  });
  useEffect(() => {
    try {
      const next = JSON.stringify(value);
      if (sessionStorage.getItem(key) !== next) {
        sessionStorage.setItem(key, next);
        // Keep other components using the same key (e.g. the cart badge) in sync.
        window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: key }));
      }
    } catch {
      /* storage full or unavailable — non-fatal */
    }
  }, [key, value]);
  useEffect(() => {
    function sync(e: Event) {
      if ((e as CustomEvent<string>).detail !== key) return;
      try {
        const raw = sessionStorage.getItem(key);
        setValue(raw != null ? (JSON.parse(raw) as T) : initial);
      } catch {
        /* ignore */
      }
    }
    window.addEventListener(SESSION_EVENT, sync);
    return () => window.removeEventListener(SESSION_EVENT, sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, setValue] as const;
}

/** Reusable confirm-then-act pattern for destructive actions (logout, cancel, archive). */
export function useConfirmAction(onConfirm: () => void) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  function request() {
    setOpen(true);
  }
  function cancel() {
    if (!busy) setOpen(false);
  }
  function confirm() {
    setBusy(true);
    try {
      onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }
  return { open, busy, request, cancel, confirm };
}
