import { PricingType, SellingUnit } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { money } from '../lib/money';
import { writeAudit } from './auditService';

export async function listProducts(params: {
  businessId: string;
  q?: string;
  category?: string;
  visibleOnly?: boolean;
  includeArchived?: boolean;
  customerId?: string;
}) {
  const where: Record<string, unknown> = {
    businessId: params.businessId,
  };
  if (!params.includeArchived) where.isArchived = false;
  if (params.visibleOnly) where.isVisible = true;
  if (params.category) where.category = params.category;
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: 'insensitive' } },
      { category: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
      {
        variants: {
          some: {
            OR: [
              { name: { contains: params.q, mode: 'insensitive' } },
              { brand: { contains: params.q, mode: 'insensitive' } },
            ],
          },
        },
      },
    ];
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      variants: { where: { isActive: true }, orderBy: { name: 'asc' } },
      favourites: params.customerId
        ? { where: { customerId: params.customerId } }
        : false,
    },
    orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
  });

  return products.map((p) => ({
    ...p,
    isFavourite: Array.isArray(p.favourites) ? p.favourites.length > 0 : false,
    variants: p.variants.map((v) => ({
      ...v,
      unitPrice: money(v.unitPrice),
    })),
  }));
}

export async function getCategories(businessId: string) {
  const rows = await prisma.product.findMany({
    where: { businessId, isArchived: false, isVisible: true },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return rows.map((r) => r.category);
}

export async function createProduct(
  businessId: string,
  actorId: string,
  data: {
    name: string;
    category: string;
    description?: string;
    imageUrl?: string;
    isVisible?: boolean;
    variants: Array<{
      name: string;
      brand?: string;
      unit: SellingUnit;
      pricingType: PricingType;
      unitPrice: string | number;
    }>;
  }
) {
  if (!data.variants?.length) throw badRequest('At least one variant required');

  const product = await prisma.product.create({
    data: {
      businessId,
      name: data.name,
      category: data.category,
      description: data.description,
      imageUrl: data.imageUrl,
      isVisible: data.isVisible ?? true,
      variants: {
        create: data.variants.map((v) => ({
          name: v.name,
          brand: v.brand,
          unit: v.unit,
          pricingType: v.pricingType,
          unitPrice: money(v.unitPrice),
          prices: {
            create: { unitPrice: money(v.unitPrice), note: 'Initial price' },
          },
        })),
      },
    },
    include: { variants: true },
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Product',
    entityId: product.id,
    action: 'CREATE',
    details: { name: product.name },
  });

  return product;
}

export async function updateProduct(
  businessId: string,
  actorId: string,
  productId: string,
  data: {
    name?: string;
    category?: string;
    description?: string | null;
    imageUrl?: string | null;
    isVisible?: boolean;
  }
) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, businessId },
  });
  if (!existing) throw notFound('Product not found');

  const product = await prisma.product.update({
    where: { id: productId },
    data,
    include: { variants: true },
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Product',
    entityId: productId,
    action: 'UPDATE',
    details: data,
  });

  return product;
}

export async function archiveProduct(businessId: string, actorId: string, productId: string) {
  const existing = await prisma.product.findFirst({
    where: { id: productId, businessId },
  });
  if (!existing) throw notFound('Product not found');

  const product = await prisma.product.update({
    where: { id: productId },
    data: { isArchived: true, isVisible: false },
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'Product',
    entityId: productId,
    action: 'ARCHIVE',
  });

  return product;
}

export async function upsertVariant(
  businessId: string,
  actorId: string,
  productId: string,
  data: {
    id?: string;
    name: string;
    brand?: string;
    unit: SellingUnit;
    pricingType: PricingType;
    unitPrice: string | number;
    isActive?: boolean;
  }
) {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
  });
  if (!product) throw notFound('Product not found');

  const price = money(data.unitPrice);

  if (data.id) {
    const variant = await prisma.productVariant.update({
      where: { id: data.id },
      data: {
        name: data.name,
        brand: data.brand,
        unit: data.unit,
        pricingType: data.pricingType,
        unitPrice: price,
        isActive: data.isActive ?? true,
        prices: { create: { unitPrice: price, note: 'Price update' } },
      },
    });
    await writeAudit({
      businessId,
      actorId,
      entityType: 'ProductVariant',
      entityId: variant.id,
      action: 'UPDATE',
      details: { unitPrice: price },
    });
    return variant;
  }

  const variant = await prisma.productVariant.create({
    data: {
      productId,
      name: data.name,
      brand: data.brand,
      unit: data.unit,
      pricingType: data.pricingType,
      unitPrice: price,
      prices: { create: { unitPrice: price, note: 'Initial price' } },
    },
  });

  await writeAudit({
    businessId,
    actorId,
    entityType: 'ProductVariant',
    entityId: variant.id,
    action: 'CREATE',
  });

  return variant;
}

export async function toggleFavourite(customerId: string, productId: string) {
  const existing = await prisma.customerFavourite.findUnique({
    where: { customerId_productId: { customerId, productId } },
  });
  if (existing) {
    await prisma.customerFavourite.delete({ where: { id: existing.id } });
    return { favourited: false };
  }
  await prisma.customerFavourite.create({ data: { customerId, productId } });
  return { favourited: true };
}

export async function recentAndMostUsed(businessId: string, customerId?: string) {
  const mostUsed = await prisma.product.findMany({
    where: { businessId, isArchived: false, isVisible: true, usageCount: { gt: 0 } },
    include: { variants: { where: { isActive: true } } },
    orderBy: { usageCount: 'desc' },
    take: 8,
  });

  const recent = await prisma.product.findMany({
    where: {
      businessId,
      isArchived: false,
      isVisible: true,
      lastUsedAt: { not: null },
    },
    include: { variants: { where: { isActive: true } } },
    orderBy: { lastUsedAt: 'desc' },
    take: 8,
  });

  let favourites: typeof mostUsed = [];
  if (customerId) {
    const favs = await prisma.customerFavourite.findMany({
      where: { customerId },
      include: {
        product: { include: { variants: { where: { isActive: true } } } },
      },
      take: 12,
    });
    favourites = favs.map((f) => f.product).filter((p) => !p.isArchived && p.isVisible);
  }

  const map = (list: typeof mostUsed) =>
    list.map((p) => ({
      ...p,
      variants: p.variants.map((v) => ({ ...v, unitPrice: money(v.unitPrice) })),
    }));

  return {
    mostUsed: map(mostUsed),
    recent: map(recent),
    favourites: map(favourites),
  };
}
