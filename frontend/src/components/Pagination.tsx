import { Button } from './ui';

export type OrderPage = { items: any[]; hasMore: boolean; page: number };

export function Pagination({ page, hasMore, busy, onChange }: { page: number; hasMore: boolean; busy: boolean; onChange: (page: number) => void }) {
  if (page === 1 && !hasMore) return null;
  return <nav aria-label="Order pages" className="mt-5 flex items-center justify-center gap-3">
    <Button variant="secondary" disabled={busy || page === 1} onClick={() => onChange(page - 1)}>Previous</Button>
    <span className="text-sm text-slate-500" aria-live="polite">Page {page}</span>
    <Button variant="secondary" disabled={busy || !hasMore} onClick={() => onChange(page + 1)}>Next</Button>
  </nav>;
}
