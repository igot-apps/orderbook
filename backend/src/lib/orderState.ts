import { OrderStatus } from '@prisma/client';
import { badRequest } from './errors';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['AWAITING_CUSTOMER_APPROVAL', 'AGREED', 'CHANGE_REQUESTED', 'CANCELLED'],
  AWAITING_CUSTOMER_APPROVAL: ['AGREED', 'CHANGE_REQUESTED', 'PREPARING', 'CANCELLED'],
  CHANGE_REQUESTED: ['PREPARING', 'CANCELLED'],
  AGREED: ['PREPARING', 'CHANGE_REQUESTED', 'DELIVERED', 'CANCELLED'],
  // Legacy statuses remain deliverable for orders created before the simplified flow.
  READY_FOR_DELIVERY: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  const allowed = TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw badRequest(`Invalid order status transition: ${from} → ${to}`);
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export { TRANSITIONS };
