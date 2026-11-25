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
          insert into "User" ("businessId", name, phone, "passwordHash", role, "staffRole", "authUserId")
          select $1, $2, $3, h, $4::"UserRole", case when $4 = 'SELLER' then 'OWNER' end, app.create_auth_user($3, h)
            from (select extensions.crypt('Test-pass-1', extensions.gen_salt('bf', 4)) h) x
          returning id, "authUserId"::text as uid, phone`, biz, name, phone, role);
        await q(`insert into "Account" (id, phone, name) values ($1::uuid, $2, $3) returning id`, u.uid, phone, name);
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
      await tx.$executeRawUnsafe(`select set_config('request.headers', $1, true)`, JSON.stringify(who && who.biz ? { 'x-business-id': who.biz } : {}));
      await tx.$executeRawUnsafe(`set local role authenticated`);
      try {
        return (await q(`select pg_temp.try_api($1, $2, $3::jsonb, $4::jsonb) as r`, method, p, JSON.stringify(query), JSON.stringify(body))).r;
      } finally {
        await tx.$executeRawUnsafe(`reset role`);
      }
    }
    const denied = (r, ...statuses) => !r.ok && statuses.includes(String(r.status));
    const leaks = (r, ...ids) => r.ok && ids.some((id) => JSON.stringify(r.data).includes(id));

    // The simulated checkout is only on where AppConfig allows it (rolled back with everything else).
    await q(`insert into "AppConfig" (key, value) values ('simulate_payments', 'true') on conflict (key) do update set value = 'true' returning key`);

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
    const ncUser = await q(`select u."authUserId"::text as uid, a."mustChangePassword" as must from "User" u join "Account" a on a.id = u."authUserId" join "Customer" c on c."userId" = u.id where c.id = $1`, nc.data?.id);
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

    // ---------- Phase 4: Paystack payments (recorded only through the service-role function) ----------
    await tx.$executeRawUnsafe(`
      create function pg_temp.try_internal(act text, args jsonb) returns jsonb language plpgsql as $f$
      declare h text; msg text;
      begin
        return jsonb_build_object('ok', true, 'data', public.paystack_internal(act, args));
      exception when others then
        get stacked diagnostics h = pg_exception_hint, msg = message_text;
        return jsonb_build_object('ok', false, 'status', coalesce(nullif(h, ''), sqlstate), 'message', msg);
      end $f$`);
    const internal = async (act, args) => (await q(`select pg_temp.try_internal($1, $2::jsonb) as r`, act, JSON.stringify(args))).r;
    const order2 = o2.data.id;
    const prep2 = await call(A.seller, 'POST', `/orders/${order2}/prepare`, {
      sendForApproval: true, deliveryCharge: '0',
      items: [{ requestItemId: o2.data.requestItems[0].id, confirmedUnitPrice: '20', actualQuantity: '1' }],
    });
    // Within tolerance the invoice is agreed straight away; otherwise the customer accepts it.
    const acc2 = prep2.data?.status === 'AGREED' ? prep2 : await call(A.c1, 'POST', `/orders/${order2}/respond`, { action: 'ACCEPT' });
    check('Second order agreed at 20.00', acc2.ok && acc2.data.agreedTotal === '20.00', prep2.message || acc2.message);
    await q(`update "AppConfig" set value = 'false' where key = 'simulate_payments' returning key`);
    const simOff = await call(A.c1, 'POST', '/payments/checkout', { orderId: order2, amount: '20', network: 'MTN', momoPhone: '0241234567' });
    check('Simulated checkout is refused when simulation is off', denied(simOff, '400'), simOff.message);
    const pageNoPayout = await call(A.c1, 'GET', `/payments/order/${order2}`);
    check('Payment page says online payments are off before setup', pageNoPayout.ok && pageNoPayout.data.onlinePayments === false && pageNoPayout.data.simulatedPayments === false, pageNoPayout.message);
    const att = await call(A.c1, 'POST', '/payments/initiate', { orderId: order2, amount: '20', network: 'MTN', momoPhone: '0241234567' });
    const ref = att.data?.internalReference;
    const good = { reference: ref, status: 'success', currency: 'GHS', amountPesewas: 2000, subaccountCode: 'ACCT_testA', providerReference: 'PSK-1', channel: 'mobile_money' };
    const noPayout = await internal('confirm', good);
    check('Charge is refused when the shop has no payout account', denied(noPayout, '400'), noPayout.message);
    await internal('save_payout', { businessId: A.biz, subaccountCode: 'ACCT_testA', settlementBank: 'MTN', settlementName: 'MTN Mobile Money', accountNumber: '0241112222', accountName: 'Shop A', actorId: A.seller.id });
    const pageWithPayout = await call(A.c1, 'GET', `/payments/order/${order2}`);
    check('Payment page offers online payment after setup', pageWithPayout.ok && pageWithPayout.data.onlinePayments === true, pageWithPayout.message);
    const wrongAmount = await internal('confirm', { ...good, amountPesewas: 1999 });
    check('Charge with the wrong amount is refused', denied(wrongAmount, '400'), wrongAmount.message);
    const wrongShop = await internal('confirm', { ...good, subaccountCode: 'ACCT_someoneelse' });
    check('Charge paid to another shop is refused', denied(wrongShop, '400'), wrongShop.message);
    const notPaid = await internal('confirm', { ...good, status: 'abandoned' });
    check('Unsuccessful charge is not recorded', denied(notPaid, '400'), notPaid.message);
    const wrongCurrency = await internal('confirm', { ...good, currency: 'NGN' });
    check('Charge in another currency is refused', denied(wrongCurrency, '400'), wrongCurrency.message);
    const confirmed = await internal('confirm', good);
    const paidPage = await call(A.c1, 'GET', `/payments/order/${order2}`);
    check('Verified Paystack charge is recorded and the order paid', confirmed.ok && confirmed.data.status === 'SUCCESS' && paidPage.data?.isPaid === true, confirmed.message);
    const again = await internal('confirm', good);
    check('Same charge twice (webhook + return) is recorded once', again.ok && again.data.idempotent === true, again.message);
    const payoutOwner = await call(A.seller, 'GET', '/payments/payout');
    check('Owner sees payout details with the number masked', payoutOwner.ok && payoutOwner.data.configured && payoutOwner.data.accountNumber.endsWith('2222') && !payoutOwner.data.accountNumber.includes('0241'), payoutOwner.message);
    const payoutCustomer = await call(A.c1, 'GET', '/payments/payout');
    check('Customers cannot see payout details', denied(payoutCustomer, '403'), payoutCustomer.message);
    const payoutOther = await call(B.seller, 'GET', '/payments/payout');
    check('Another shop does not see our payout details', payoutOther.ok && payoutOther.data.configured === false, payoutOther.message);
    const privs = await q(`select has_function_privilege('authenticated', 'public.paystack_internal(text,jsonb)', 'execute') as auth_x,
                                  has_function_privilege('anon', 'public.paystack_internal(text,jsonb)', 'execute') as anon_x,
                                  has_function_privilege('service_role', 'public.paystack_internal(text,jsonb)', 'execute') as svc_x`);
    check('Only the server (service role) can record Paystack charges', privs?.auth_x === false && privs?.anon_x === false && privs?.svc_x === true);

    // ---------- Phase 2: one account, many shops ----------
    const shop2 = await call(A.seller, 'POST', '/businesses', { name: 'Second shop' });
    check('Owner can open a second shop', shop2.ok && shop2.data.businessId, shop2.message);
    const S2 = { uid: A.seller.uid, biz: shop2.data?.businessId };
    const SA = { uid: A.seller.uid, biz: A.biz };
    const mine = await call(SA, 'GET', '/auth/businesses');
    check('Owner sees both shops on one account', mine.ok && mine.data.length === 2, mine.message);
    const s2Customers = await call(S2, 'GET', '/customers');
    check('Second shop starts empty (no shop A customers)', s2Customers.ok && s2Customers.data.length === 0, s2Customers.message);
    const s2Products = await call(S2, 'GET', '/products');
    check('Second shop has no shop A products', s2Products.ok && (s2Products.data.items || s2Products.data).length === 0, s2Products.message);
    const meA = await call(SA, 'GET', '/auth/me');
    check('Shop header selects shop A', meA.ok && meA.data.businessId === A.biz && meA.data.staffRole === 'OWNER', meA.message);
    const foreign = await call({ uid: A.seller.uid, biz: B.biz }, 'GET', '/customers');
    check('Cannot pick a shop you do not belong to (401)', denied(foreign, '401'), foreign.message);
    const staffCreateBlocked = await call(A.c1, 'POST', '/businesses', { name: 'Nope' });
    check('Customer cannot open a shop', denied(staffCreateBlocked, '403'), staffCreateBlocked.message);

    const linked = await call(S2, 'POST', '/customers', { name: 'Shared customer', phone: A.c1.phone });
    check('Existing account is linked, not given a new password', linked.ok && linked.data.existingAccount === true && !linked.data.temporaryPassword, linked.message);
    const c1Shops = await call(A.c1, 'GET', '/auth/businesses');
    check('Customer now sees two shops', c1Shops.ok && c1Shops.data.length === 2, c1Shops.message);
    const c1InS2 = await call({ uid: A.c1.uid, biz: S2.biz }, 'GET', '/orders');
    check('Customer sees no shop A orders inside shop 2', c1InS2.ok && (c1InS2.data.items || c1InS2.data).length === 0, c1InS2.message);
    const resetShared = await call(S2, 'POST', `/customers/${linked.data?.id}/reset-password`);
    check('Shop cannot reset a password shared with another shop', denied(resetShared, '409'), resetShared.message);
    await call(A.c1, 'POST', '/auth/pin/set', { pin: '135790' });
    const pinS2 = await call({ uid: A.c1.uid, biz: S2.biz }, 'GET', '/auth/pin');
    check('PIN belongs to the account (same in every shop)', pinS2.ok && pinS2.data.hasPin === true, pinS2.message);

    const staff = await call(SA, 'POST', '/staff', { name: 'Staff A', phone: rand() });
    check('Owner can add staff with a temporary password', staff.ok && /^[A-HJ-NP-Z2-9]{8}$/.test(staff.data.temporaryPassword || ''), staff.message);
    const staffUid = (await q(`select "authUserId"::text as uid from "User" where id = $1`, staff.data?.id))?.uid;
    await q(`update "Account" set "mustChangePassword" = false where id = $1::uuid returning id`, staffUid);
    const ST = { uid: staffUid };
    const stCustomers = await call(ST, 'GET', '/customers');
    check('Staff can work with customers', stCustomers.ok && stCustomers.data.length >= 2, stCustomers.message);
    const stStaff = await call(ST, 'GET', '/staff');
    check('Staff cannot manage staff', denied(stStaff, '403'), stStaff.message);
    const stSettings = await call(ST, 'PATCH', '/reports/settings', { defaultDeliveryCharge: 99 });
    check('Staff cannot change shop settings', denied(stSettings, '403'), stSettings.message);
    const stShop = await call(ST, 'POST', '/businesses', { name: 'Nope' });
    check('Staff cannot open a shop', denied(stShop, '403'), stShop.message);
    const ownerRow = (await q(`select id from "User" where "authUserId" = $1::uuid and "businessId" = $2`, A.seller.uid, A.biz))?.id;
    const offOwner = await call(SA, 'POST', `/staff/${ownerRow}/deactivate`);
    check('Owner cannot be deactivated', denied(offOwner, '400'), offOwner.message);
    const crossStaff = await call(B.seller, 'POST', `/staff/${staff.data?.id}/deactivate`);
    check('Other shop cannot touch our staff', denied(crossStaff, '404'), crossStaff.message);
    const off = await call(SA, 'POST', `/staff/${staff.data?.id}/deactivate`);
    const afterOff = await call(ST, 'GET', '/customers');
    check('Deactivated staff lose access', off.ok && denied(afterOff, '401'), off.message || afterOff.message);

    // ---------- Phase 3: shop sign-up (no SMS) ----------
    await tx.$executeRawUnsafe(`
      create function pg_temp.try_signup(n text, ph text, pw text, shop text) returns jsonb language plpgsql as $f$
      declare h text; msg text;
      begin
        return jsonb_build_object('ok', true, 'data', public.signup(n, ph, pw, shop));
      exception when others then
        get stacked diagnostics h = pg_exception_hint, msg = message_text;
        return jsonb_build_object('ok', false, 'status', coalesce(nullif(h, ''), sqlstate), 'message', msg);
      end $f$`);
    async function signup(name, phone, pw, shop) {
      await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
      await tx.$executeRawUnsafe(`set local role anon`);
      try {
        return (await q(`select pg_temp.try_signup($1, $2, $3, $4) as r`, name, phone, pw, shop)).r;
      } finally {
        await tx.$executeRawUnsafe(`reset role`);
      }
    }
    const newPhone = rand();
    const su = await signup('New Owner', newPhone, 'Strong-pass-9', 'New Shop');
    check('Visitor can sign up with a new shop', su.ok, su.message);
    const suRow = await q(`select a.id::text as uid, a."phoneVerified" as verified, a."mustChangePassword" as must from "Account" a where a.phone = $1`, newPhone);
    check('Self-registered number is marked unverified', suRow?.verified === false && suRow?.must === false);
    const suMe = await call({ uid: suRow?.uid }, 'GET', '/auth/me');
    check('New owner signs in to their own shop as owner', suMe.ok && suMe.data.role === 'SELLER' && suMe.data.staffRole === 'OWNER' && suMe.data.businessName === 'New Shop', suMe.message);
    const suCustomers = await call({ uid: suRow?.uid }, 'GET', '/customers');
    check('New shop starts empty', suCustomers.ok && suCustomers.data.length === 0, suCustomers.message);
    const dup = await signup('Someone', newPhone, 'Strong-pass-9', 'Copy Shop');
    check('Same phone cannot sign up twice', denied(dup, '409'), dup.message);
    const takenPhone = await signup('Someone', A.c1.phone, 'Strong-pass-9', 'Grab Shop');
    check('Cannot sign up with a number already in use', denied(takenPhone, '409'), takenPhone.message);
    const weakSignup = await signup('Someone', rand(), '123456789', 'Weak Shop');
    check('Weak password is rejected at sign-up', denied(weakSignup, '400'), weakSignup.message);
    const badPhone = await signup('Someone', '12ab', 'Strong-pass-9', 'Bad Shop');
    check('Invalid phone is rejected at sign-up', denied(badPhone, '400'), badPhone.message);
    const linkUnverified = await call(A.seller, 'POST', '/customers', { name: 'Claimed number', phone: newPhone });
    check('Shops cannot link an unverified self-registered number', denied(linkUnverified, '409'), linkUnverified.message);
    await q(`insert into "SignupLog" ("createdAt") select now() from generate_series(1, 20) returning 1`);
    const limited = await signup('Flood', rand(), 'Strong-pass-9', 'Flood Shop');
    check('Sign-ups are rate-limited', denied(limited, '429'), limited.message);
    const anonTable = await q(`select has_table_privilege('anon', '"SignupLog"', 'select') as s, has_function_privilege('anon', 'public.signup(text,text,text,text)', 'execute') as f`);
    check('Visitors can only call sign-up, not read sign-up data', anonTable?.s === false && anonTable?.f === true);

    // ---------- Phase 5: OrderBook subscription ----------
    const CA = { uid: A.c1.uid, biz: A.biz };
    await tx.$executeRawUnsafe(`
      create function pg_temp.try_billing(act text, args jsonb) returns jsonb language plpgsql as $f$
      declare h text; msg text;
      begin
        return jsonb_build_object('ok', true, 'data', public.billing_internal(act, args));
      exception when others then
        get stacked diagnostics h = pg_exception_hint, msg = message_text;
        return jsonb_build_object('ok', false, 'status', coalesce(nullif(h, ''), sqlstate), 'message', msg);
      end $f$`);
    const billingInternal = async (act, args) => (await q(`select pg_temp.try_billing($1, $2::jsonb) as r`, act, JSON.stringify(args))).r;
    const trial = await call(SA, 'GET', '/billing');
    check('New shop is on a 30-day trial', trial.ok && trial.data.status === 'TRIAL' && trial.data.daysLeft >= 29 && trial.data.plans.length === 2, trial.message);
    const custBilling = await call(CA, 'GET', '/billing/status');
    check('Customers cannot see shop billing', denied(custBilling, '403'), custBilling.message);
    const setTrial = (biz, days) => q(`insert into "Subscription" ("businessId", "trialEndsAt") values ($1, now() + make_interval(days => $2::int))
      on conflict ("businessId") do update set "trialEndsAt" = excluded."trialEndsAt", "paidUntil" = null returning 1`, biz, days);
    await setTrial(A.biz, -2);
    const grace = await call(SA, 'GET', '/billing/status');
    const graceOrder = await call(CA, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Within 7 days after expiry the shop keeps working (grace)', grace.data?.status === 'GRACE' && graceOrder.ok, grace.message || graceOrder.message);
    await setTrial(A.biz, -8);
    const expired = await call(SA, 'GET', '/billing/status');
    check('After the grace period the shop is expired', expired.ok && expired.data.status === 'EXPIRED', expired.message);
    const blockedOrder = await call(CA, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Expired shop takes no new customer orders', denied(blockedOrder, '402'), blockedOrder.message);
    const blockedCustomer = await call(SA, 'POST', '/customers', { name: 'Late', phone: rand() });
    check('Expired shop cannot add customers', denied(blockedCustomer, '402'), blockedCustomer.message);
    const stillReads = await call(SA, 'GET', '/customers');
    check('Expired shop can still see its data', stillReads.ok, stillReads.message);
    const otherShop = await call(B.c1, 'POST', '/orders', { items: [{ variantId: B.variant, requestedAmount: '20' }] });
    check('Another shop is not affected', otherShop.ok, otherShop.message);

    const start = await billingInternal('start', { businessId: A.biz, months: 1, actorId: A.seller.id });
    check('Monthly renewal costs GH₵50', start.ok && start.data.amountPesewas === 5000, start.message);
    const badMonths = await billingInternal('start', { businessId: A.biz, months: 3 });
    check('Only monthly or yearly plans exist', denied(badMonths, '400'), badMonths.message);
    const subGood = { reference: start.data?.reference, status: 'success', currency: 'GHS', amountPesewas: 5000, providerReference: 'SUB-1', subaccountCode: null };
    const subWrongAmount = await billingInternal('confirm', { ...subGood, amountPesewas: 100 });
    check('Underpaid subscription is refused', denied(subWrongAmount, '400'), subWrongAmount.message);
    const subToShop = await billingInternal('confirm', { ...subGood, subaccountCode: 'ACCT_shop' });
    check('Subscription paid to a shop subaccount is refused', denied(subToShop, '400'), subToShop.message);
    const renewed = await billingInternal('confirm', subGood);
    check('Verified renewal reactivates an expired shop for a month', renewed.ok && renewed.data.status === 'ACTIVE' && renewed.data.daysLeft >= 27 && renewed.data.daysLeft <= 31, renewed.message || JSON.stringify(renewed.data));
    const renewedAgain = await billingInternal('confirm', subGood);
    check('Same renewal counted once', renewedAgain.ok && renewedAgain.data.idempotent === true && renewedAgain.data.daysLeft === renewed.data.daysLeft, renewedAgain.message);
    const afterRenew = await call(CA, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Renewed shop takes orders again', afterRenew.ok, afterRenew.message);

    const yearStart = await billingInternal('start', { businessId: B.biz, months: 12 });
    const yearDone = await billingInternal('confirm', { reference: yearStart.data?.reference, status: 'success', currency: 'GHS', amountPesewas: 50000, providerReference: 'SUB-2' });
    check('Paying during the trial adds the year after the trial ends', yearDone.ok && yearDone.data.status === 'ACTIVE' && yearDone.data.daysLeft >= 390, yearDone.message || JSON.stringify(yearDone.data));
    const billPrivs = await q(`select has_function_privilege('authenticated', 'public.billing_internal(text,jsonb)', 'execute') as a,
                                      has_function_privilege('anon', 'public.billing_internal(text,jsonb)', 'execute') as b`);
    check('Only the server can record subscription payments', billPrivs?.a === false && billPrivs?.b === false);

    // ---------- Phase 6: super-admin ----------
    const notAdmin = await call(SA, 'GET', '/admin/shops');
    check('Shop owners are not OrderBook admins', denied(notAdmin, '403'), notAdmin.message);
    const meBefore = await call(SA, 'GET', '/auth/me');
    check('/auth/me says the user is not an admin', meBefore.ok && meBefore.data.isAdmin === false, meBefore.message);
    await q(`insert into "PlatformAdmin" ("accountId") values ($1::uuid) returning 1`, B.seller.uid);
    const AD = B.seller;
    const meAdmin = await call(AD, 'GET', '/auth/me');
    check('/auth/me flags the admin', meAdmin.ok && meAdmin.data.isAdmin === true, meAdmin.message);
    const shops = await call(AD, 'GET', '/admin/shops');
    const shopA = shops.data?.find?.((s) => s.id === A.biz);
    check('Admin sees every shop with owner and subscription', shops.ok && !!shopA && !!shopA.owner?.phone && !!shopA.subscription?.status, shops.message);
    const found = await call(AD, 'GET', '/admin/shops', {}, { search: shopA?.owner?.phone?.slice(-6) || 'x' });
    check('Admin can search shops by owner phone', found.ok && found.data.some((s) => s.id === A.biz), found.message);
    const overview = await call(AD, 'GET', '/admin/overview');
    check('Admin overview has totals and 12 months', overview.ok && overview.data.shops >= 2 && overview.data.months.length === 12, overview.message);
    const custAdmin = await call(CA, 'GET', '/admin/overview');
    check('Customers cannot open admin', denied(custAdmin, '403'), custAdmin.message);

    await setTrial(A.biz, -8);
    const badGift = await call(AD, 'POST', `/admin/shops/${A.biz}/gift`, { days: 0 });
    check('Gift must be 1–366 days', denied(badGift, '400'), badGift.message);
    const gift = await call(AD, 'POST', `/admin/shops/${A.biz}/gift`, { days: 14, note: 'pilot' });
    check('Gifting 14 days reactivates an expired shop', gift.ok && gift.data.status === 'ACTIVE' && gift.data.daysLeft >= 13 && gift.data.daysLeft <= 15, gift.message || JSON.stringify(gift.data));
    const ownerGift = await call(SA, 'POST', `/admin/shops/${A.biz}/gift`, { days: 30 });
    check('Shop owners cannot gift themselves time', denied(ownerGift, '403'), ownerGift.message);

    const noReason = await call(AD, 'POST', `/admin/shops/${A.biz}/suspend`, {});
    check('Suspending needs a reason', denied(noReason, '400'), noReason.message);
    const susp = await call(AD, 'POST', `/admin/shops/${A.biz}/suspend`, { reason: 'Test' });
    check('Admin can suspend a shop', susp.ok && susp.data.suspended === true, susp.message);
    const suspOrder = await call(CA, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Suspended shop takes no new orders', denied(suspOrder, '402'), suspOrder.message);
    const suspRead = await call(SA, 'GET', '/customers');
    const suspStatus = await call(SA, 'GET', '/billing/status');
    check('Suspended shop can still read and sees why', suspRead.ok && suspStatus.data?.suspended === true, suspRead.message || suspStatus.message);
    const unsusp = await call(AD, 'POST', `/admin/shops/${A.biz}/unsuspend`);
    const backOrder = await call(CA, 'POST', '/orders', { items: [{ variantId: A.variant, requestedAmount: '20' }] });
    check('Unsuspended shop takes orders again', unsusp.ok && unsusp.data.suspended === false && backOrder.ok, unsusp.message || backOrder.message);
    const adminPriv = await q(`select has_table_privilege('authenticated', '"PlatformAdmin"', 'insert') as a`);
    check('Nobody can make themselves admin through the API', adminPriv?.a === false);

    // ---------- Phase 7: feedback + setup checklist ----------
    const fbShort = await call(CA, 'POST', '/feedback', { message: 'a' });
    check('Empty feedback is refused', denied(fbShort, '400'), fbShort.message);
    const fbCust = await call(CA, 'POST', '/feedback', { message: 'The approve button is hard to find', page: '/customer/orders' });
    const fbSeller = await call(SA, 'POST', '/feedback', { message: 'Please add bulk prices' });
    check('Customers and sellers can send feedback', fbCust.ok && fbSeller.ok, fbCust.message || fbSeller.message);
    const fbOwnerList = await call(SA, 'GET', '/admin/feedback');
    check('Shop owners cannot read feedback', denied(fbOwnerList, '403'), fbOwnerList.message);
    const fbList = await call(AD, 'GET', '/admin/feedback');
    const fbItem = fbList.data?.find?.((f) => f.message === 'The approve button is hard to find');
    check('Admin reads feedback with who and which shop', fbList.ok && !!fbItem && fbItem.role === 'CUSTOMER' && !!fbItem.shop && fbItem.page === '/customer/orders', fbList.message);
    const fbDone = await call(AD, 'POST', `/admin/feedback/${fbItem?.id}/done`);
    const fbOpenAfter = await call(AD, 'GET', '/admin/feedback');
    check('Admin can mark feedback done', fbDone.ok && !fbOpenAfter.data.some((f) => f.id === fbItem?.id), fbDone.message);
    for (let i = 0; i < 9; i++) await call(CA, 'POST', '/feedback', { message: `spam ${i}` });
    const fbLimit = await call(CA, 'POST', '/feedback', { message: 'one more' });
    check('Feedback is rate-limited', denied(fbLimit, '429'), fbLimit.message);
    const setup = await call(SA, 'GET', '/setup');
    check('Setup checklist reports first steps', setup.ok && setup.data.products === true && setup.data.customers === true && setup.data.isOwner === true, setup.message);
    const setupCust = await call(CA, 'GET', '/setup');
    check('Customers have no setup checklist', denied(setupCust, '403'), setupCust.message);

    throw ROLLBACK;
  }, { timeout: 300000, maxWait: 20000 }).catch((e) => { if (e !== ROLLBACK) throw e; });

  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  — ${r.detail}` : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed (${useProduction ? 'production' : 'staging'}, all changes rolled back)`);
  process.exitCode = failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[url]').slice(-1500)); process.exitCode = 1; })
  .finally(() => db.$disconnect());
