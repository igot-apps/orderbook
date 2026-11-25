import { useState } from 'react';
import { Dialog, Input } from './ui';
import { ghs, unitLabel } from '../lib/format';

type Variant = { id: string; name: string; brand?: string; unit: string; unitPrice: string; pricingType: string };
export type VariationProduct = { id: string; name: string; variants: Variant[] };

export function ProductVariations({ product, onClose, onSelect }: {
  product: VariationProduct | null;
  onClose: () => void;
  onSelect: (variant: Variant) => void;
}) {
  const [search, setSearch] = useState('');
  const variants = product?.variants.filter((v) => `${v.name} ${v.brand || ''}`.toLowerCase().includes(search.trim().toLowerCase())) || [];
  return <Dialog open={!!product} onClose={onClose} title={product?.name || 'Choose variation'} description="Choose the variation you want to order.">
    {!!product && product.variants.length > 6 && <Input label="Search variations" placeholder="Search name or brand" value={search} onChange={(e) => setSearch(e.target.value)} />}
    <div className="mt-3 space-y-2">
      {variants.map((v) => <button key={v.id} type="button" onClick={() => onSelect(v)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 text-left hover:bg-brand-50">
        <span className="min-w-0"><span className="block text-sm font-semibold">{v.brand ? `${v.brand} · ${v.name}` : v.name}</span><span className="block text-xs text-slate-500">{ghs(v.unitPrice)} / {unitLabel(v.unit)}</span></span>
        <span className="shrink-0 text-sm font-semibold text-brand-700">Select</span>
      </button>)}
      {!variants.length && <p className="py-4 text-sm text-slate-500">{product?.variants.length ? 'No variations match your search.' : 'No variations available.'}</p>}
    </div>
  </Dialog>;
}

export function variationSummary(product: VariationProduct) {
  return product.variants.length ? `${product.variants.length} variation${product.variants.length === 1 ? '' : 's'} · From ${ghs(Math.min(...product.variants.map((v) => Number(v.unitPrice))))}` : 'No variations available';
}
