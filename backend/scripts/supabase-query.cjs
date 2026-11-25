// Run a read-only SQL query against the production (Supabase) database and print JSON rows.
// Usage: node scripts/supabase-query.cjs "select 1"
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

async function main() {
  const url = process.env.DATABASE_URL_PRODUCTION;
  if (!url) throw new Error('DATABASE_URL_PRODUCTION is empty.');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const rows = await client.$queryRawUnsafe(process.argv[2]);
    console.log(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
  } finally {
    await client.$disconnect();
  }
}
main().catch((e) => {
  console.error(String(e.message).replace(/postgres(?:ql)?:\/\/[^\s`]+/gi, '[connection URL]').slice(-1500));
  process.exit(1);
});
