import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, PricingType, SellingUnit } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding OrderProof...');

  // Setup is repeatable and must never erase orders or payments.
  const existingSeller = await prisma.user.findFirst({ where: { phone: '0240000000', role: 'SELLER' } });
  if (existingSeller) {
    console.log('Existing store found. Preserving all PostgreSQL data.');
    return;
  }

  const passwordHash = await bcrypt.hash('123456789', 10);

  const business = await prisma.business.create({
    data: {
      name: 'OrderProof Store',
      phone: '0240000000',
      settings: {
        create: {
          approvalToleranceAbs: '2.00',
          approvalTolerancePct: '5.00',
          defaultDeliveryCharge: '10.00',
        },
      },
    },
  });

  await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'OrderProof Store',
      phone: '0240000000',
      passwordHash,
      role: 'SELLER',
    },
  });

  const amaUser = await prisma.user.create({
    data: {
      businessId: business.id,
      name: 'Ama Mensah',
      phone: '0241111111',
      passwordHash,
      role: 'CUSTOMER',
    },
  });

  await prisma.customer.create({
    data: {
      businessId: business.id,
      userId: amaUser.id,
      name: 'Ama Mensah',
      phone: '0241111111',
      creditAllowed: true,
      notes: 'Preferred customer — East Legon',
    },
  });

  type V = {
    name: string;
    brand?: string;
    unit: SellingUnit;
    pricingType: PricingType;
    unitPrice: string;
  };

  async function addProduct(
    name: string,
    category: string,
    description: string,
    variants: V[],
    _usageCount = 0
  ) {
    return prisma.product.create({
      data: {
        businessId: business.id,
        name,
        category,
        description,
        isVisible: true,
        usageCount: 0,
        lastUsedAt: null,
        variants: {
          create: variants.map((v) => ({
            name: v.name,
            brand: v.brand,
            unit: v.unit,
            pricingType: v.pricingType,
            unitPrice: v.unitPrice,
            prices: { create: { unitPrice: v.unitPrice, note: 'Seed price' } },
          })),
        },
      },
      include: { variants: true },
    });
  }

  await addProduct(
    'Salmon',
    'Fish',
    'Fresh Atlantic salmon, priced per kilogram. Final weight confirmed at preparation.',
    [{ name: 'Standard', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '40.00' }],
    12
  );

  await addProduct('Tilapia', 'Fish', 'Fresh whole tilapia.', [
    { name: 'Medium', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '28.00' },
    { name: 'Large', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '32.00' },
  ], 8);

  await addProduct('Mackerel', 'Fish', 'Smoked or fresh mackerel.', [
    { name: 'Fresh', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '25.00' },
    { name: 'Smoked', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '30.00' },
  ], 5);

  await addProduct(
    'Sausage',
    'Meat',
    'Assorted sausage packs and units.',
    [
      { name: 'Sadia', brand: 'Sadia', unit: 'PACK', pricingType: 'FIXED_UNIT', unitPrice: '15.00' },
      { name: 'Minu', brand: 'Minu', unit: 'PACK', pricingType: 'FIXED_UNIT', unitPrice: '13.00' },
      { name: 'Nat', brand: 'Nat', unit: 'PIECE', pricingType: 'FIXED_UNIT', unitPrice: '3.00' },
    ],
    15
  );

  await addProduct('Chicken', 'Meat', 'Frozen chicken portions.', [
    { name: 'Whole', brand: 'Darko Farms', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '35.00' },
    { name: 'Wings', brand: 'Darko Farms', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '38.00' },
    { name: 'Thighs pack', brand: 'Darko Farms', unit: 'PACK', pricingType: 'FIXED_UNIT', unitPrice: '45.00' },
  ], 10);

  await addProduct('Beef', 'Meat', 'Assorted beef cuts.', [
    { name: 'Stewing beef', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '48.00' },
    { name: 'Minced', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '50.00' },
  ], 4);

  await addProduct('Eggs', 'Dairy & Eggs', 'Fresh tray eggs.', [
    { name: 'Crate (30)', brand: 'Local', unit: 'BOX', pricingType: 'FIXED_UNIT', unitPrice: '55.00' },
    { name: 'Half crate (15)', brand: 'Local', unit: 'PACK', pricingType: 'FIXED_UNIT', unitPrice: '30.00' },
  ], 9);

  await addProduct('Rice', 'Staples', 'Imported and local rice.', [
    { name: 'Royal Aroma 5kg', brand: 'Royal Aroma', unit: 'BAG', pricingType: 'FIXED_UNIT', unitPrice: '85.00' },
    { name: 'Local rice', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '12.00' },
  ], 7);

  await addProduct('Cooking Oil', 'Staples', 'Vegetable cooking oil.', [
    { name: 'Frytol 1L', brand: 'Frytol', unit: 'BOTTLE', pricingType: 'FIXED_UNIT', unitPrice: '28.00' },
    { name: 'Frytol 5L', brand: 'Frytol', unit: 'BOTTLE', pricingType: 'FIXED_UNIT', unitPrice: '120.00' },
  ], 6);

  await addProduct('Tomato Paste', 'Groceries', 'Tinned tomato paste.', [
    { name: 'Gino 400g', brand: 'Gino', unit: 'PIECE', pricingType: 'FIXED_UNIT', unitPrice: '12.00' },
    { name: 'Olam 2.2kg', brand: 'Olam', unit: 'BOX', pricingType: 'FIXED_UNIT', unitPrice: '45.00' },
  ], 3);

  await addProduct('Shrimp', 'Seafood', 'Fresh or frozen shrimp.', [
    { name: 'Medium', unit: 'KILOGRAM', pricingType: 'PER_MEASUREMENT', unitPrice: '90.00' },
  ], 2);

  await addProduct('Yoghurt', 'Dairy & Eggs', 'Drinking yoghurt.', [
    { name: 'Fan Milk 500ml', brand: 'Fan Milk', unit: 'BOTTLE', pricingType: 'FIXED_UNIT', unitPrice: '8.00' },
  ], 4);

  console.log('Seed complete.');
  console.log('Seller: 0240000000 / 123456789');
  console.log('Customer Ama: 0241111111 / 123456789');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
