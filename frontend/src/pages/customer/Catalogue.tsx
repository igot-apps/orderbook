import { ProductVariations, variationSummary } from '../../components/ProductVariations';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { ghs, unitLabel } from '../../lib/format';
import { useDebouncedValue, useSessionState } from '../../lib/hooks';
import { Button, Card, Empty, Input, Loading, Page } from '../../components/ui';

type Product = {
  id: string;
  name: string;
  category: string;
  description?: string;
  isFavourite?: boolean;
  variants: Array<{
    id: string;
    name: string;
    brand?: string;
    unit: string;
    pricingType: string;
    unitPrice: string;
  }>;
};

export function CataloguePage() {
  const [q, setQ] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState('');
  const [cart] = useSessionState<Array<{ requestedAmount: string }>>('op-cart', []);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const debouncedQ = useDebouncedValue(q, 350);

  const productsQuery = useQuery({
    queryKey: ['products', debouncedQ, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedQ) params.set('q', debouncedQ);
      if (category) params.set('category', category);
      return api<Product[]>(`/products?${params}`);
    },
    placeholderData: (prev) => prev,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<string[]>('/products/meta/categories'),
  });

  const highlightsQuery = useQuery({
    queryKey: ['highlights'],
    queryFn: () =>
      api<{ favourites: Product[]; recent: Product[]; mostUsed: Product[] }>(
        '/products/meta/highlights'
      ),
  });

  const favMut = useMutation({
    meta: { success: 'Favourites updated' },
    mutationFn: (id: string) => api(`/products/${id}/favourite`, { method: 'POST' }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['products'] });
      await qc.cancelQueries({ queryKey: ['highlights'] });
      const prevProducts = qc.getQueryData<Product[]>(['products', debouncedQ, category]);
      const prevHighlights = qc.getQueryData<{ favourites: Product[]; recent: Product[]; mostUsed: Product[] }>(['highlights']);
      // Optimistic flip so the star responds instantly.
      if (prevProducts) {
        qc.setQueryData<Product[]>(
          ['products', debouncedQ, category],
          prevProducts.map((p) => (p.id === id ? { ...p, isFavourite: !p.isFavourite } : p))
        );
      }
      return { prevProducts, prevHighlights };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prevProducts) qc.setQueryData(['products', debouncedQ, category], ctx.prevProducts);
      if (ctx?.prevHighlights) qc.setQueryData(['highlights'], ctx.prevHighlights);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['highlights'] });
    },
  });

  const products = productsQuery.data || [];
  const cats = categoriesQuery.data || [];
  const searching = q !== debouncedQ;

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of products) {
      const list = map.get(p.category) || [];
      list.push(p);
      map.set(p.category, list);
    }
    return [...map.entries()];
  }, [products]);

  return (
    <Page
      title="Shop"
      subtitle="Browse prices and add the amount you want for each item."
      actions={
        <Link to={cart.length ? '/customer/orders/new?cart=1' : '/customer/orders/new'}>
          <Button>{cart.length ? `View basket · ${cart.length}` : 'Start shopping'}</Button>
        </Link>
      }
    >
      <div role="search">
        <Input
          label="Search catalogue"
          placeholder="Search product, brand, category…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
        <button
          type="button"
          aria-pressed={!category}
          className={`min-h-11 shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
            !category ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 border border-slate-200'
          }`}
          onClick={() => setCategory('')}
        >
          All
        </button>
        {cats.map((c) => (
          <button
            type="button"
            key={c}
            aria-pressed={category === c}
            className={`min-h-11 shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              category === c
                ? 'bg-brand-700 text-white'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
            onClick={() => setCategory(category === c ? '' : c)}
          >
            {c}
          </button>
        ))}
      </div>

      {highlightsQuery.data && !debouncedQ && !category && (
        <div className="mt-5 space-y-4">
          {!!highlightsQuery.data.favourites.length && (
            <ChipRow title="Favourites" products={highlightsQuery.data.favourites} />
          )}
        </div>
      )}

      <div className="mt-6" aria-live="polite">
        {(productsQuery.isLoading || searching) && !products.length ? (
          <Loading label={searching ? 'Searching…' : 'Loading catalogue…'} />
        ) : products.length === 0 ? (
          <Empty
            title={debouncedQ || category ? 'No products match your search' : 'No products found'}
            hint="Try a different spelling, or browse all products."
            action={
              (debouncedQ || category) ? (
                <Button variant="secondary" onClick={() => { setQ(''); setCategory(''); }}>
                  Clear search & filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {grouped.map(([cat, list]) => (
              <section key={cat} aria-label={cat}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {cat}
                </h2>
                <div className="space-y-3">
                  {list.map((p) => (
                    <Card key={p.id}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{p.name}</div>
                          {p.description && (
                            <p className="mt-0.5 text-sm text-slate-500 line-clamp-2">
                              {p.description}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl transition hover:bg-amber-50"
                          title={p.isFavourite ? 'Remove from favourites' : 'Save to favourites'}
                          aria-label={p.isFavourite ? `Remove ${p.name} from favourites` : `Save ${p.name} to favourites`}
                          aria-pressed={!!p.isFavourite}
                          onClick={() => favMut.mutate(p.id)}
                        >
                          <span aria-hidden="true">{p.isFavourite ? '⭐' : '☆'}</span>
                        </button>
                      </div>
              <button type="button" className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-left hover:bg-brand-50" onClick={() => setSelectedProduct(p)} aria-label={'Choose variation for ' + p.name}>
                <span className="text-sm text-slate-600">{variationSummary(p)}</span>
                <span className="shrink-0 text-sm font-semibold text-brand-700">Choose variation</span>
              </button>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <ProductVariations key={selectedProduct?.id || 'closed'} product={selectedProduct} onClose={() => setSelectedProduct(null)} onSelect={(v) => navigate('/customer/orders/new?variantId=' + v.id + '&productId=' + selectedProduct!.id)} />
    </Page>
  );
}

function ChipRow({ title, products }: { title: string; products: Product[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-600">{title}</h3>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {products.map((p) => (
          <Link
            key={p.id}
            to={`/customer/orders/new?productId=${p.id}`}
            className="min-h-11 shrink-0 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200"
          >
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-slate-500">
              {variationSummary(p)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
