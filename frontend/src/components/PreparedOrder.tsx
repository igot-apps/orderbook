import { Card } from './ui';
import { formatWhen, ghs, unitLabel } from '../lib/format';

export function PreparedOrder({ order, revision }: { order: any; revision: any }) {
  const originals = order.requestItems || [];
  const items = revision.items || [];
  const rows = [
    ...originals.map((original: any) => ({ original, item: items.find((i: any) => i.requestItemId === original.id) })),
    ...items.filter((item: any) => !originals.some((o: any) => o.id === item.requestItemId)).map((item: any) => ({ original: undefined, item })),
  ];
  const difference = Math.round((Number(revision.grandTotal) - Number(order.estimatedTotal)) * 100) / 100;
  return <section className="mt-6" aria-label="Prepared order">
    <h2 className="mb-2 font-semibold">Prepared invoice</h2>
    <Card>
      <div className="mb-4 flex justify-between gap-4 border-b border-slate-200 pb-4 text-sm">
        <div><div className="text-xs uppercase text-slate-500">Prepared for</div><div className="mt-1 font-semibold">{order.customer?.name || 'You'}</div>{order.customer?.phone && <div className="mt-1 text-xs text-slate-500">{order.customer.phone}</div>}</div>
        <div className="text-right"><div className="text-xs uppercase text-slate-500">Order</div><div className="mt-1 font-semibold">{order.orderNumber}</div>{order.createdAt && <div className="mt-1 text-xs text-slate-500">{formatWhen(order.createdAt)}</div>}</div>
      </div>
      <h3 className="mb-1 text-sm font-semibold">Items</h3>
      <div className="divide-y divide-slate-100">
        {rows.map(({ original, item }: any) => {
          const removed = !item || item.isRemoved;
          const added = !original;
          const changed = removed || added || item.isReplacement ||
            Number(item.actualLineTotal) !== Number(original.requestedAmount) ||
            Number(item.actualQuantity) !== Number(original.estimatedQuantity) ||
            Number(item.confirmedUnitPrice) !== Number(original.catalogueUnitPrice) ||
            item.productNameSnapshot !== original.productNameSnapshot || item.variantNameSnapshot !== original.variantNameSnapshot;
          const current = item || original;
          const name = [current.productNameSnapshot, current.variantNameSnapshot].filter(Boolean).join(' · ');
          return <div key={item?.id || original.id} className="py-4 text-sm">
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-semibold">{name}</h3>
              <span className="shrink-0 font-bold">{ghs(removed ? 0 : item.actualLineTotal)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{removed ? 'Not included in your order' : Number(item.actualQuantity) + ' ' + unitLabel(item.unitSnapshot) + ' × ' + ghs(item.confirmedUnitPrice)}</div>
            {changed && original && <p className="mt-1 text-xs text-slate-500">Requested: {ghs(original.requestedAmount)} · {Number(original.estimatedQuantity)} {unitLabel(original.unitSnapshot)}{item?.isReplacement && ' · ' + original.productNameSnapshot + ' ' + (original.variantNameSnapshot || '')}</p>}
            {changed && <p className="mt-1 text-xs text-orange-700"><strong>{removed ? 'Removed' : added ? 'Added' : item.isReplacement ? 'Replaced' : 'Changed'}:</strong> {item?.priceChangeReason || 'No reason was recorded. Contact the shop for details.'}</p>}
            {item?.note && item.note !== original?.note && <p className="mt-1 text-xs text-slate-500">Note: {item.note}</p>}
          </div>;
        })}
      </div>
      <div className="mt-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        <div className="flex justify-between gap-3"><span>Items subtotal</span><span>{ghs(revision.itemsTotal)}</span></div>
        <div className="mt-2 flex justify-between gap-3"><span>Delivery</span><span>{ghs(revision.deliveryCharge)}</span></div>
        {Number(revision.deliveryCharge) !== Number(order.estimatedDeliveryCharge) && <p className="mt-1 text-slate-500">Delivery changed from {ghs(order.estimatedDeliveryCharge)} to {ghs(revision.deliveryCharge)}.</p>}
        {revision.preparationNote && <p className="mt-2 text-slate-600">Seller note: {revision.preparationNote}</p>}
        <div className="mt-3 flex justify-between gap-3 border-t border-slate-200 pt-3 text-lg font-bold text-slate-950"><span>Total</span><span>{ghs(revision.grandTotal)}</span></div>
        <p className="mt-1 text-slate-500">Originally requested: {ghs(order.estimatedTotal)} · {difference === 0 ? 'No change to total' : `${difference > 0 ? 'Increase' : 'Decrease'}: ${ghs(Math.abs(difference))}`}</p>
      </div>
    </Card>
  </section>;
}
