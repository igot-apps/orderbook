// OrderBook — Supabase SQL backend tests: business data isolation, roles, and the main order/payment flow.
//
// Everything runs inside ONE transaction that is always rolled back, so no test data is left behind.
// Two throwaway businesses (A and B) are created inside that transaction.
//
// Usage (from backend/):
//   node scripts/supabase-tests.cjs                 → uses DATABASE_URL_STAGING (recommended)
//   node scripts/supabase-tests.cjs --production    → uses DATABASE_URL_PRODUCTION (still rolled back)
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');

const useProduction = process.argv.includes('--production');
const url = useProduction ? process.env.DATABASE_URL_PRODUCTION : process.env.DATABASE_URL_STAGING;
if (!url) {
  console.error(useProduction
    ? 'DATABASE_URL_PRODUCTION is empty.'
    : 'DATABASE_URL_STAGING is empty. Set it in backend/.env, or pass --production to run (rolled back) against production.');
  process.exit(2);
}

const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const ROLLBACK = new Error('ROLLBACK');

async function main() {
  await db.$transaction(async (tx) => {
    const q = async (sql, ...params) => (await tx.$queryRawUnsafe(sql, ...params))[0];
    const rand = () => '09' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

    // Captures errors (status comes from the error hint) without aborting the transaction.
    await tx.$executeRawUnsafe(`
      create function pg_temp.try_api(m text, p text, qy jsonb, b jsonb) returns jsonb language plpgsql as $f$
      declare h text; msg text;
      begin
        return jsonb_build_object('ok', true, 'data', public.api(m, p, qy, b));
      exception when others then
        get stacked diagnostics h = pg_exception_hint, msg = message_text;
        return jsonb_build_object('ok', false, 'status', coalesce(nullif(h, ''), sqlstate), 'message', msg);
      end $f$`);

    // ---------- Fixtures: two businesses ----------
    async function makeBusiness(label) {
      const biz = (await q(`insert into "Business" (name) values ($1) returning id`, `Test ${label} ${Date.now()}`)).id;
      await q(`insert into "BusinessSettings" ("businessId") values ($1) returning id`, biz);
      const user = async (role, name) => {
        const phone = rand();
        const u = await q(`
          insert into "User" ("businessId", name, phone, "passwordHash", role, "authUserId")
          select $1, $2, $3, h, $4::"UserRole", app.create_auth_user($3, h)
            from (select extensions.crypt('Test-pass-1', extensions.gen_salt('bf', 4)) h) x
          returning id, "authUserId"::text as uid`, biz, name, phone, role);
        if (role === 'CUSTOMER') {
          u.customerId = (await q(`insert into "Customer" ("businessId", "userId", name, phone) values ($1, $2, $3, $4) returning id`, biz, u.id, name, phone)).id;
        }
        return u;
      };
      const seller = await user('SELLER', `Seller ${label}`);
      const c1 = await user('CUSTOMER', `Customer ${label}1`);
      const c2 = await user('CUSTOMER', `Customer ${label}2`);
      const product = (await q(`insert into "Product" ("businessId", name, category) values ($1, $2, 'Test') returning id`, biz, `Rice ${label}`)).id;
      const variant = (await q(`insert into "ProductVariant" ("productId", name, unit, "pricingType", "unitPrice") values ($1, 'Bag', 'PIECE', 'FIXED_UNIT', 20) returning id`, product)).id;
      return { biz, seller, c1, c2, product, variant };
    }
    const A = await makeBusiness('A');
    const B = await makeBusiness('B');

    async function call(who, method, p, body = {}, query = {}) {
      await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', $1, true)`,
        JSON.stringify({ sub: who ? who.uid : '00000000-0000-0000-0000-000000000001', role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }));
      await tx.$executeRawUnsafe(`set local role authenticated`);
      try {
        return (await q(`select pg_temp.try_api($1, $2, $3::jsonb, $4::jsonb) as r`, method, p, JSON.stringify(query), JSON.stringify(body))).r;
      } finally {
        await tx.$executeRawUnsafe(`reset role`);
      }
    }
    const denied = (r, ...statuses) => !r.ok && statuses.includes(String(r.status));
    const leaks = (r, ...ids) => r.ok && ids.some((id) => JSON.stringify(r.data).includes(id));

    // ---------- Main flow in business A ----------
    const o1 = await call(A.c1, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '40' }] });
    check('Customer can place an order', o1.ok && o1.data.status === 'SUBMITTED', o1.message);
    const o2 = await call(A.c1, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Order numbers count up per shop (OP-00001, OP-00002)', o1.data?.orderNumber === 'OP-00001' && o2.data?.orderNumber === 'OP-00002', `${o1.data?.orderNumber}, ${o2.data?.orderNumber}`);
    const ob = await call(B.c1, 'POST', '/orders', { items: [{ variantId: B.variant, requestedAmount: '20' }] });
    check('Another shop has its own numbering', ob.data?.orderNumber === 'OP-00001', ob.data?.orderNumber);

    const orderA = o1.data.id;
    const reqItem = o1.data.requestItems[0];
    const prep = await call(A.seller, 'POST', `/orders/${orderA}/prepare`, {
      sendForApproval: true, deliveryCharge: '5',
      items: [{ requestItemId: reqItem.id, confirmedUnitPrice: '20', actualQuantity: '2.5', priceChangeReason: 'Weighed extra' }],
    });
    check('Seller prepares and sends invoice for approval', prep.ok && prep.data.status === 'AWAITING_CUSTOMER_APPROVAL', prep.message);
    const acc = await call(A.c1, 'POST', `/orders/${orderA}/respond`, { action: 'ACCEPT' });
    check('Customer accepts invoice (total 55.00)', acc.ok && acc.data.status === 'AGREED' && acc.data.agreedTotal === '55.00', acc.message || acc.data?.agreedTotal);
    const pay1 = await call(A.c1, 'POST', '/payments/checkout', { orderId: orderA, amount: '30', network: 'MTN', momoPhone: '0241234567' });
    const page1 = await call(A.c1, 'GET', `/payments/order/${orderA}`);
    check('Partial payment reduces balance to 25.00', pay1.ok && page1.data?.outstandingBalance === '25.00', pay1.message || page1.data?.outstandingBalance);
    const over = await call(A.c1, 'POST', '/payments/checkout', { orderId: orderA, amount: '26', network: 'MTN', momoPhone: '0241234567' });
    check('Cannot pay more than the balance', denied(over, '400'), over.message);
    const pay2 = await call(A.c1, 'POST', '/payments/checkout', { orderId: orderA, amount: '25', network: 'MTN', momoPhone: '0241234567' });
    const page2 = await call(A.c1, 'GET', `/payments/order/${orderA}`);
    check('Paying the rest marks the order paid', pay2.ok && page2.data?.isPaid === true && page2.data?.outstandingBalance === '0.00', pay2.message);
    const done = await call(A.seller, 'POST', `/orders/${orderA}/deliver`, {});
    check('Seller completes delivery', done.ok && done.data.status === 'COMPLETED', done.message);
    const receipt = await call(A.c1, 'GET', `/payments/receipts/${pay1.data?.id}`);
    check('Customer can open their receipt', receipt.ok && receipt.data.orderNumber === 'OP-00001', receipt.message);
    const paymentA = pay1.data?.id;

    // ---------- Temporary passwords ----------
    const nc = await call(A.seller, 'POST', '/customers', { name: 'New Customer', phone: rand() });
    check('New customer gets an 8-character temporary password', nc.ok && /^[A-HJ-NP-Z2-9]{8}$/.test(nc.data.temporaryPassword || ''), nc.message);
    check('No shared default password is used', nc.ok && nc.data.temporaryPassword !== '123456789');
    const ncUser = await q(`select u."authUserId"::text as uid, u."mustChangePassword" as must from "User" u join "Customer" c on c."userId" = u.id where c.id = $1`, nc.data?.id);
    check('New customer must change password', ncUser?.must === true);
    const blocked = await call({ uid: ncUser.uid }, 'GET', '/products');
    check('Temporary-password user is blocked until they change it', denied(blocked, '403'), blocked.message);
    const meOk = await call({ uid: ncUser.uid }, 'GET', '/auth/me');
    check('…but can still load their profile', meOk.ok);
    const wrong = await call({ uid: ncUser.uid }, 'POST', '/auth/change-password', { currentPassword: 'WRONG-PASS', newPassword: 'Good-pass-2026' });
    check('Change password rejects a wrong current password', denied(wrong, '400'));
    const weak = await call({ uid: ncUser.uid }, 'POST', '/auth/change-password', { currentPassword: nc.data.temporaryPassword, newPassword: '123456789' });
    check('Change password rejects 123456789', denied(weak, '400'));
    const changed = await call({ uid: ncUser.uid }, 'POST', '/auth/change-password', { currentPassword: nc.data.temporaryPassword, newPassword: 'Good-pass-2026' });
    const after = await call({ uid: ncUser.uid }, 'GET', '/products');
    check('After changing password the app works', changed.ok && after.ok, changed.message || after.message);
    const authOk = await q(`select app.password_ok('Good-pass-2026', a.encrypted_password) as ok from auth.users a where a.id = $1::uuid`, ncUser.uid);
    check('New password is the Supabase login password', authOk?.ok === true);
    const reset = await call(A.seller, 'POST', `/customers/${nc.data.id}/reset-password`);
    check('Seller can issue a new temporary password', reset.ok && reset.data.temporaryPassword?.length === 8, reset.message);
    const resetB = await call(B.seller, 'POST', `/customers/${nc.data.id}/reset-password`);
    check('Other shop cannot reset this customer’s password', denied(resetB, '404'));

    // ---------- Isolation: shop B seller vs shop A data ----------
    const bChecks = [
      ['GET', `/orders/${orderA}`], ['GET', `/customers/${A.c1.customerId}`], ['PATCH', `/customers/${A.c1.customerId}`, { name: 'x' }],
      ['GET', `/payments/receipts/${paymentA}`], ['PATCH', `/products/${A.product}`, { name: 'x' }],
      ['POST', `/products/${A.product}/archive`], ['POST', `/products/${A.product}/variants`, { name: 'x', unit: 'PIECE', pricingType: 'FIXED_UNIT', unitPrice: '1' }],
      ['POST', `/orders/${o2.data.id}/prepare/start`], ['POST', `/orders/${o2.data.id}/agree-phone`, { note: 'x' }],
      ['POST', `/orders/${o2.data.id}/ready`], ['POST', `/orders/${o2.data.id}/dispatch`], ['POST', `/orders/${o2.data.id}/deliver`],
      ['POST', `/orders/${o2.data.id}/cancel`, { reason: 'x' }], ['PUT', `/drafts/${A.c1.customerId}`, { cart: [{ x: 1 }] }],
      ['POST', '/orders', { customerId: A.c1.customerId, items: [{ variantId: B.variant, requestedAmount: '10' }] }],
      ['POST', '/payments/initiate', { orderId: o2.data.id, amount: '1', network: 'MTN', momoPhone: '0241234567' }],
    ];
    for (const [m, p, body] of bChecks) {
      const r = await call(B.seller, m, p, body || {});
      check(`Shop B seller blocked: ${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}`, denied(r, '403', '404'), r.ok ? 'ALLOWED' : r.message);
    }
    const crossVariant = await call(B.seller, 'POST', '/orders', { customerId: B.c1.customerId, items: [{ variantId: A.variant, requestedAmount: '10' }] });
    check('Shop B cannot order shop A’s products', denied(crossVariant, '400'), crossVariant.message);
    const payPageB = await call(B.seller, 'GET', `/payments/order/${orderA}`);
    check('Shop B cannot open shop A’s payment page', denied(payPageB, '403', '404'));

    const allA = [orderA, o2.data.id, A.c1.customerId, A.c2.customerId, A.product, A.variant, paymentA];
    for (const p of ['/orders', '/customers', '/products', '/payments', '/payments/attempts', '/customers/outstanding/aging', '/drafts', '/orders/dashboard/seller']) {
      const r = await call(B.seller, 'GET', p);
      check(`Shop B list shows no shop A data: ${p}`, r.ok && !leaks(r, ...allA), r.ok ? '' : r.message);
    }
    const reportsB = await call(B.seller, 'GET', '/reports');
    check('Shop B reports exclude shop A money', reportsB.ok && reportsB.data.verifiedPaymentsReceived.total === '0.00');

    // ---------- Isolation: customers ----------
    const cB = [['GET', `/orders/${orderA}`], ['POST', `/products/${A.product}/favourite`], ['POST', `/orders/${o2.data.id}/respond`, { action: 'ACCEPT' }], ['GET', `/payments/receipts/${paymentA}`]];
    for (const [m, p, body] of cB) {
      const r = await call(B.c1, m, p, body || {});
      check(`Shop B customer blocked: ${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}`, denied(r, '403', '404'), r.ok ? 'ALLOWED' : r.message);
    }
    for (const p of ['/orders', '/products', '/notifications/me', '/payments/history/me', '/orders/dashboard/customer']) {
      const r = await call(B.c1, 'GET', p);
      check(`Shop B customer list shows no shop A data: ${p}`, r.ok && !leaks(r, ...allA), r.ok ? '' : r.message);
    }
    const sameShop = [['GET', `/orders/${orderA}`], ['GET', `/payments/order/${orderA}`], ['GET', `/payments/receipts/${paymentA}`], ['POST', `/orders/${o2.data.id}/respond`, { action: 'ACCEPT' }]];
    for (const [m, p, body] of sameShop) {
      const r = await call(A.c2, m, p, body || {});
      check(`Other customer in same shop blocked: ${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}`, denied(r, '403', '404'), r.ok ? 'ALLOWED' : r.message);
    }
    const c2Orders = await call(A.c2, 'GET', '/orders');
    check('Customer order list shows only their own orders', c2Orders.ok && !leaks(c2Orders, orderA, o2.data.id));

    // ---------- Roles and sign-in ----------
    for (const [m, p] of [['GET', '/customers'], ['GET', '/reports'], ['POST', '/products'], ['GET', '/payments'], ['GET', '/drafts']]) {
      const r = await call(A.c1, m, p);
      check(`Customer cannot use seller endpoint ${m} ${p}`, denied(r, '403'), r.ok ? 'ALLOWED' : r.message);
    }
    const sellerRespond = await call(A.seller, 'POST', `/orders/${o2.data.id}/respond`, { action: 'ACCEPT' });
    check('Seller cannot approve on the customer’s behalf via respond', denied(sellerRespond, '403'));
    const stranger = await call(null, 'GET', '/orders');
    check('Signed-in user with no OrderBook account is rejected (401)', denied(stranger, '401'));
    await tx.$executeRawUnsafe(`set local role anon`);
    let anonBlocked = false;
    try { await tx.$queryRawUnsafe(`select has_function_privilege('anon', 'public.api(text,text,jsonb,jsonb)', 'execute') as x`).then((r) => { anonBlocked = r[0].x === false; }); } finally { await tx.$executeRawUnsafe(`reset role`); }
    check('Signed-out visitors cannot call the API', anonBlocked);
    const direct = await q(`select bool_and(not has_table_privilege('authenticated', format('public.%I', tablename), 'select')) as ok from pg_tables where schemaname = 'public'`);
    check('Signed-in users cannot read any table directly', direct?.ok === true);
    const rls = await q(`select bool_and(rowsecurity) as ok from pg_tables where schemaname = 'public'`);
    check('Row-level security is on for every table', rls?.ok === true);

    throw ROLLBACK;
  }, { timeout: 120000, maxWait: 20000 }).catch((e) => { if (e !== ROLLBACK) throw e; });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  — ${r.detail}` : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${useProduction ? 'production' : 'staging'}, all changes rolled back)`);
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[url]').slice(-1500)); process.exitCode = 1; })
  .finally(() => db.$disconnect());
