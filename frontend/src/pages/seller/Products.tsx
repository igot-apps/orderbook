import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { ghs, unitLabel } from '../../lib/format';
import {
  Button,
  Card,
  Dialog,
  Icon,
  ConfirmDialog,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Page,
  Select,
} from '../../components/ui';

export function SellerProductsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    category: 'Fish',
    description: '',
    variantName: 'Standard',
    brand: '',
    unit: 'KILOGRAM',
    pricingType: 'PER_MEASUREMENT',
    unitPrice: '40',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['seller-products'],
    queryFn: () => api<any[]>('/products?includeArchived=true'),
  });

  const createMut = useMutation({
    meta: { success: 'Product added', silentError: true },
    mutationFn: () =>
      api('/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          category: form.category,
          description: form.description || undefined,
          variants: [
            {
              name: form.variantName,
              brand: form.brand || undefined,
              unit: form.unit,
              pricingType: form.pricingType,
              unitPrice: form.unitPrice,
            },
          ],
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seller-products'] });
      setOpen(false);
      setError('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed'),
  });

  const archiveMut = useMutation({
    meta: { success: 'Product archived' },
    mutationFn: (id: string) => api(`/products/${id}/archive`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seller-products'] }),
  });

  const visibilityMut = useMutation({
    meta: { success: 'Visibility updated' },
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) =>
      api(`/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seller-products'] }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    createMut.mutate();
  }

  return (
    <Page
      title="Products"
      subtitle="Catalogue guide — not warehouse stock"
      actions={<Button onClick={() => setOpen(true)}><Icon name="plus" className="h-4 w-4" /> Add product</Button>}
    >
      <Dialog open={open} onClose={() => setOpen(false)} title="Add product" description="Customers will see it in the catalogue.">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={onSubmit}>
            <Input
              label="Product name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              label="Category"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            />
            <Input
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <Input
              label="Variant name"
              value={form.variantName}
              onChange={(e) => setForm({ ...form, variantName: e.target.value })}
            />
            <Input
              label="Brand"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            />
            <Select
              label="Unit"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            >
              {['KILOGRAM', 'GRAM', 'LITRE', 'PIECE', 'PACK', 'BAG', 'BOTTLE', 'BOX', 'CUSTOM'].map(
                (u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                )
              )}
            </Select>
            <Select
              label="Pricing type"
              value={form.pricingType}
              onChange={(e) => setForm({ ...form, pricingType: e.target.value })}
            >
              <option value="PER_MEASUREMENT">Price per measurement</option>
              <option value="FIXED_UNIT">Fixed unit price</option>
            </Select>
            <Input
              label="Unit price"
              type="number"
              step="0.01"
              value={form.unitPrice}
              onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
              required
            />
            {error && (
              <div className="sm:col-span-2">
                <ErrorBox message={error} />
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={createMut.isPending}>
                Save product
              </Button>
            </div>
          </form>
      </Dialog>

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="No products" />
      ) : (
        <div className="space-y-3">
          {data.map((p) => (
            <Card key={p.id} className={p.isArchived ? 'opacity-60' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">
                    {p.name}{' '}
                    <span className="text-sm font-normal text-slate-500">· {p.category}</span>
                  </div>
                  {p.description && (
                    <p className="mt-1 text-sm text-slate-500">{p.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {!p.isArchived && (
                    <>
                      <Button
                        variant="secondary"
                        className="!py-2 text-xs"
                        onClick={() =>
                          visibilityMut.mutate({ id: p.id, isVisible: !p.isVisible })
                        }
                      >
                        {p.isVisible ? 'Hide' : 'Show'}
                      </Button>
                      <Button
                        variant="ghost"
                        className="!py-2 text-xs text-rose-600"
                        onClick={() => setArchiveTarget({ id: p.id, name: p.name })}
                      >
                        Archive
                      </Button>
                    </>
                  )}
                  {p.isArchived && <span className="text-xs text-slate-500">Archived</span>}
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {p.variants.map((v: any) => (
                  <div
                    key={v.id}
                    className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <span>
                      {v.brand ? `${v.brand} · ` : ''}
                      {v.name}
                    </span>
                    <span className="font-medium">
                      {ghs(v.unitPrice)} / {unitLabel(v.unit)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!archiveTarget}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => { if (archiveTarget) archiveMut.mutate(archiveTarget.id); setArchiveTarget(null); }}
        title={`Archive ${archiveTarget?.name ?? 'product'}?`}
        description="Customers will no longer see it in the catalogue. Past orders are kept."
        confirmLabel="Archive"
        danger
      />
    </Page>
  );
}
