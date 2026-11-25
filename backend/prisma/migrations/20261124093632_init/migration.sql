-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SELLER', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('PER_MEASUREMENT', 'FIXED_UNIT');

-- CreateEnum
CREATE TYPE "SellingUnit" AS ENUM ('KILOGRAM', 'GRAM', 'LITRE', 'PIECE', 'PACK', 'BAG', 'BOTTLE', 'BOX', 'CUSTOM');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PREPARING', 'AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED', 'AGREED', 'READY_FOR_DELIVERY', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgreementMethod" AS ENUM ('DIGITAL', 'PHONE', 'AUTO_WITHIN_TOLERANCE');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentNetwork" AS ENUM ('MTN', 'TELECEL', 'AT_MONEY');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_RECEIVED', 'AWAITING_APPROVAL', 'CHANGE_REQUESTED', 'ORDER_FINALIZED', 'ORDER_READY', 'ORDER_DISPATCHED', 'ORDER_DELIVERED', 'PAYMENT_LINK', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'BALANCE_REMINDER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'READY', 'DISPATCHED', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "approvalToleranceAbs" DECIMAL(12,2) NOT NULL DEFAULT 2.00,
    "approvalTolerancePct" DECIMAL(8,2) NOT NULL DEFAULT 5.00,
    "defaultDeliveryCharge" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'GHS',

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "creditAllowed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "unit" "SellingUnit" NOT NULL,
    "pricingType" "PricingType" NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerFavourite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerFavourite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryInstructions" TEXT,
    "estimatedDeliveryCharge" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "requestedItemsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "estimatedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "agreedTotal" DECIMAL(12,2),
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "outstandingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "agreedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRequestItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "productNameSnapshot" TEXT NOT NULL,
    "variantNameSnapshot" TEXT,
    "brandSnapshot" TEXT,
    "unitSnapshot" "SellingUnit" NOT NULL,
    "pricingTypeSnapshot" "PricingType" NOT NULL,
    "catalogueUnitPrice" DECIMAL(12,2) NOT NULL,
    "requestedAmount" DECIMAL(12,2) NOT NULL,
    "estimatedQuantity" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRevision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "preparedById" TEXT,
    "deliveryCharge" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "itemsTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "grandTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "requestedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "differenceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "differencePercent" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "preparationNote" TEXT,
    "changeRequestNote" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "sentForApprovalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRevisionItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "variantNameSnapshot" TEXT,
    "brandSnapshot" TEXT,
    "unitSnapshot" "SellingUnit" NOT NULL,
    "pricingTypeSnapshot" "PricingType" NOT NULL,
    "catalogueUnitPrice" DECIMAL(12,2) NOT NULL,
    "confirmedUnitPrice" DECIMAL(12,2) NOT NULL,
    "priceChangeReason" TEXT,
    "requestedAmount" DECIMAL(12,2) NOT NULL,
    "estimatedQuantity" DECIMAL(14,4) NOT NULL,
    "actualQuantity" DECIMAL(14,4) NOT NULL,
    "actualLineTotal" DECIMAL(12,2) NOT NULL,
    "differenceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,
    "isReplacement" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevisionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAgreement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "method" "AgreementMethod" NOT NULL,
    "recordedById" TEXT,
    "customerNote" TEXT,
    "phoneNote" TEXT,
    "agreedTotal" DECIMAL(12,2) NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "instructions" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "courierName" TEXT,
    "courierPhone" TEXT,
    "proofNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "internalReference" TEXT NOT NULL,
    "providerReference" TEXT,
    "network" "PaymentNetwork" NOT NULL,
    "momoPhone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "webhookPayload" JSONB,
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "network" "PaymentNetwork" NOT NULL,
    "momoPhone" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT,
    "paymentId" TEXT,
    "recipientPhone" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'SENT',
    "linkPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessSettings_businessId_key" ON "BusinessSettings"("businessId");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_businessId_phone_key" ON "User"("businessId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_businessId_idx" ON "Customer"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_phone_key" ON "Customer"("businessId", "phone");

-- CreateIndex
CREATE INDEX "Product_businessId_category_idx" ON "Product"("businessId", "category");

-- CreateIndex
CREATE INDEX "Product_businessId_isVisible_isArchived_idx" ON "Product"("businessId", "isVisible", "isArchived");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductPrice_variantId_idx" ON "ProductPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerFavourite_customerId_productId_key" ON "CustomerFavourite"("customerId", "productId");

-- CreateIndex
CREATE INDEX "Order_businessId_status_idx" ON "Order"("businessId", "status");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_businessId_orderNumber_key" ON "Order"("businessId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderRequestItem_orderId_idx" ON "OrderRequestItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderRevision_orderId_idx" ON "OrderRevision"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRevision_orderId_revisionNumber_key" ON "OrderRevision"("orderId", "revisionNumber");

-- CreateIndex
CREATE INDEX "OrderRevisionItem_revisionId_idx" ON "OrderRevisionItem"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAgreement_revisionId_key" ON "OrderAgreement"("revisionId");

-- CreateIndex
CREATE INDEX "OrderAgreement_orderId_idx" ON "OrderAgreement"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_internalReference_key" ON "PaymentAttempt"("internalReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_providerReference_key" ON "PaymentAttempt"("providerReference");

-- CreateIndex
CREATE INDEX "PaymentAttempt_orderId_idx" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_businessId_idx" ON "PaymentAttempt"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_attemptId_key" ON "Payment"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_businessId_idx" ON "Payment"("businessId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_orderId_idx" ON "PaymentAllocation"("orderId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "Notification_businessId_createdAt_idx" ON "Notification"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientPhone_idx" ON "Notification"("recipientPhone");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPrice" ADD CONSTRAINT "ProductPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFavourite" ADD CONSTRAINT "CustomerFavourite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerFavourite" ADD CONSTRAINT "CustomerFavourite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRequestItem" ADD CONSTRAINT "OrderRequestItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRevisionItem" ADD CONSTRAINT "OrderRevisionItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OrderRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAgreement" ADD CONSTRAINT "OrderAgreement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAgreement" ADD CONSTRAINT "OrderAgreement_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "OrderRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAgreement" ADD CONSTRAINT "OrderAgreement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
