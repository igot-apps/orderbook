/** Tiny global toast store — call toast.success('Saved') from anywhere. */
export type ToastKind = 'success' | 'error' | 'info';
export type ToastItem = { id: number; kind: ToastKind; message: string };

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, message: string, ms = 3200) {
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, message }];
  emit();
  window.setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(l: Listener) {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}

export const toast = {
  success: (m: string) => push('success', m),
  error: (m: string) => push('error', m, 4500),
  info: (m: string) => push('info', m),
};
