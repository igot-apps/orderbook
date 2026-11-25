const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

async function main() {
  const saved = process.env.DATABASE_URL_PRODUCTION;
  if (!saved) throw new Error('DATABASE_URL_PRODUCTION is empty.');
  const base = new URL(saved);
  if (!base.hostname.endsWith('.pooler.supabase.com')) throw new Error('Expected the Supabase shared pooler URL.');
  for (const port of ['5432', '6543']) {
    const url = new URL(base);
    url.port = port;
    url.searchParams.set('sslmode', 'require');
    url.searchParams.set('connect_timeout', '15');
    if (port === '6543') url.searchParams.set('pgbouncer', 'true');
    const client = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    console.log(`Testing ${port === '5432' ? 'session' : 'transaction'} pooler on port ${port}...`);
    try {
      await client.$queryRaw`SELECT 1`;
      const users = await client.user.count();
      console.log(`SUCCESS on port ${port}. OrderProof User table contains ${users} accounts.`);
    } catch (error) {
      let message = String(error.message);
      message = message.replace(/postgres(?:ql)?:\/\/[^\s`]+/gi, '[connection URL]');
      for (const secret of [base.password, decodeURIComponent(base.password)]) {
        if (secret) message = message.split(secret).join('[password]');
      }
      console.log(`FAILED on port ${port}: ${message.slice(-1500)}`);
    } finally {
      await client.$disconnect();
    }
  }
}
main().catch(() => { console.error('Check the format of DATABASE_URL_PRODUCTION in backend/.env.'); process.exitCode = 1; });
