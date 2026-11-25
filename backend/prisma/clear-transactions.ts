import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// Explicit maintenance command. Keeps users, customers, products and prices.
const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_CLEAR_TRANSACTIONS !== 'yes') {
    throw new Error('Set CONFIRM_CLEAR_TRANSACTIONS=yes to clear order and payment history.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.paymentAllocation.deleteMany();
    await tx.payment.deleteMany();
    await tx.paymentAttempt.deleteMany();
    await tx.notification.deleteMany();
    await tx.auditLog.deleteMany();
    await tx.orderAgreement.deleteMany();
    await tx.orderRevisionItem.deleteMany();
    await tx.orderRevision.deleteMany();
    await tx.orderRequestItem.deleteMany();
    await tx.delivery.deleteMany();
    await tx.order.deleteMany();
  });
  console.log('Order, payment and notification history cleared. Accounts and catalogue preserved.');
}

main().finally(() => prisma.$disconnect());
