export function ghs(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `GH₵${n.toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function unitLabel(unit: string): string {
  const map: Record<string, string> = {
    KILOGRAM: 'kg',
    GRAM: 'g',
    LITRE: 'L',
    PIECE: 'piece',
    PACK: 'pack',
    BAG: 'bag',
    BOTTLE: 'bottle',
    BOX: 'box',
    CUSTOM: 'unit',
  };
  return map[unit] || unit.toLowerCase();
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: 'Draft',
    SUBMITTED: 'Order received',
    PREPARING: 'Being prepared',
    AWAITING_CUSTOMER_APPROVAL: 'Approval needed',
    CHANGE_REQUESTED: 'Being revised',
    AGREED: 'Order confirmed',
    READY_FOR_DELIVERY: 'Ready',
    DISPATCHED: 'On the way',
    DELIVERED: 'Delivered',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return labels[status] || status;
}

export function orderStatusLabel(status: string, audience: 'customer' | 'seller'): string {
  if (audience === 'customer') return statusLabel(status);
  const sellerLabels: Record<string, string> = {
    SUBMITTED: 'New order',
    PREPARING: 'Preparation in progress',
    AWAITING_CUSTOMER_APPROVAL: 'Waiting for customer',
    CHANGE_REQUESTED: 'Revision needed',
    AGREED: 'Awaiting payment',
    DELIVERED: 'Marked delivered',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  };
  return sellerLabels[status] || statusLabel(status);
}

export function orderStatusHint(status: string, audience: 'customer' | 'seller'): string {
  const customer: Record<string, string> = {
    SUBMITTED: 'Order received. Your order is being prepared.',
    PREPARING: 'The shop is weighing and preparing your items.',
    AWAITING_CUSTOMER_APPROVAL: 'Review the corrected amount before the order continues.',
    CHANGE_REQUESTED: 'The shop will contact you and revise the order.',
    AGREED: 'Your final total is ready.',
    DELIVERED: 'The shop marked this order as delivered.',
    COMPLETED: 'The shop has completed this order.',
  };
  const seller: Record<string, string> = {
    SUBMITTED: 'Review the request and enter the actual prepared amount.',
    PREPARING: 'Correct the weight or price and record the agreement.',
    AWAITING_CUSTOMER_APPROVAL: 'The customer needs to review the revised amount.',
    CHANGE_REQUESTED: 'Call the customer and revise the invoice.',
    AGREED: 'The price is agreed; mark the order completed when fulfilled.',
    DELIVERED: 'Delivery has been recorded.',
    COMPLETED: 'This order has been completed.',
  };
  return (audience === 'customer' ? customer : seller)[status] || '';
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    SUBMITTED: 'bg-sky-100 text-sky-800',
    PREPARING: 'bg-amber-100 text-amber-800',
    AWAITING_CUSTOMER_APPROVAL: 'bg-violet-100 text-violet-800',
    CHANGE_REQUESTED: 'bg-orange-100 text-orange-800',
    AGREED: 'bg-emerald-100 text-emerald-800',
    READY_FOR_DELIVERY: 'bg-cyan-100 text-cyan-800',
    DISPATCHED: 'bg-indigo-100 text-indigo-800',
    DELIVERED: 'bg-teal-100 text-teal-800',
    COMPLETED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-rose-100 text-rose-800',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

export function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

