export function lineAmount(quantity: string | number, unitPrice: string | number): string {
  return (Math.round((Number(quantity) || 0) * (Number(unitPrice) || 0) * 100) / 100).toFixed(2);
}

export function quantityForAmount(amount: string | number, unitPrice: string | number): string {
  const price = Number(unitPrice);
  if (!Number.isFinite(price) || price <= 0) return '0';
  return ((Number(amount) || 0) / price).toFixed(4);
}
