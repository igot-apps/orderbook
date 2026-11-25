// OrderBook — Paystack Mobile Money (Supabase Edge Function).
//
// Deploy with JWT checking off, because Paystack's webhook has no Supabase login; every other
// action checks the caller's Supabase session itself:
//   npx supabase functions deploy paystack --no-verify-jwt --project-ref <ref>
// Secrets (Dashboard → Edge Functions → Secrets):
//   PAYSTACK_SECRET_KEY    sk_test_… or sk_live_…
//   PLATFORM_FEE_PERCENT   optional, OrderBook's share of each payment (default 0)
//
// Money flow: each shop has a Paystack subaccount; charges are split to it, so the shop is paid directly.
// Nothing is recorded from what the browser or the webhook says: the function always fetches the
// transaction from Paystack and passes the verified facts to public.paystack_internal('confirm').
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-business-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAYSTACK_KEY = Deno.env.get('PAYSTACK_SECRET_KEY') || '';
const FEE_PERCENT = Math.min(Math.max(Number(Deno.env.get('PLATFORM_FEE_PERCENT') || 0), 0), 20);
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function paystack(path: string, init: RequestInit = {}) {
  if (!PAYSTACK_KEY) throw new HttpError(503, 'Online payments are not configured yet.');
  const res = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${PAYSTACK_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.status) throw new HttpError(res.status >= 500 ? 502 : 400, body.message || 'Paystack request failed.');
  return body.data;
}

async function internal(action: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc('paystack_internal', { p_action: action, p_args: args });
  if (error) throw new HttpError(Number(error.hint) || 400, error.message);
  return data;
}

/** Calls the normal app API as the signed-in user, so all role and shop checks still apply. */
function asUser(req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Please sign in again.');
  const headers: Record<string, string> = { Authorization: authorization };
  const biz = req.headers.get('x-business-id');
  if (biz) headers['x-business-id'] = biz;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers }, auth: { persistSession: false } });
  return async <T>(method: string, path: string, body: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await client.rpc('api', { p_method: method, p_path: path, p_query: {}, p_body: body });
    if (error) throw new HttpError(Number(error.hint) || (error.code === '42501' ? 401 : 400), error.message);
    return data as T;
  };
}

/** Fetches the charge from Paystack and records it if it really succeeded for this shop. */
async function settle(reference: string) {
  const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (tx.reference !== reference) throw new HttpError(400, 'Payment reference does not match.');
  if (tx.status !== 'success') {
    if (['failed', 'reversed', 'abandoned'].includes(tx.status)) await internal('fail', { reference, reason: tx.gateway_response || tx.status });
    return { status: tx.status, message: tx.gateway_response || 'Payment not completed yet.' };
  }
  const subaccountCode = tx.subaccount?.subaccount_code || tx.split?.subaccounts?.[0]?.subaccount_code || null;
  const recorded = await internal('confirm', {
    reference, status: tx.status, currency: tx.currency, amountPesewas: tx.amount,
    subaccountCode, providerReference: String(tx.id), channel: tx.channel, paidAt: tx.paid_at,
  });
  return { status: 'success', paymentId: recorded.paymentId, receiptNumber: recorded.receiptNumber };
}

async function billing(action: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc('billing_internal', { p_action: action, p_args: args });
  if (error) throw new HttpError(Number(error.hint) || 400, error.message);
  return data;
}

/** Same as settle(), for OrderBook subscription payments (paid to OrderBook's own account). */
async function settleSubscription(reference: string) {
  const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (tx.reference !== reference) throw new HttpError(400, 'Payment reference does not match.');
  if (tx.status !== 'success') {
    if (['failed', 'reversed', 'abandoned'].includes(tx.status)) await billing('fail', { reference, reason: tx.gateway_response || tx.status });
    return { status: tx.status, message: tx.gateway_response || 'Payment not completed yet.' };
  }
  const state = await billing('confirm', {
    reference, status: tx.status, currency: tx.currency, amountPesewas: tx.amount,
    subaccountCode: tx.subaccount?.subaccount_code || null, providerReference: String(tx.id),
  });
  return { status: 'success', subscription: state };
}

async function hmacHex(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    // ---------- Paystack webhook ----------
    const signature = req.headers.get('x-paystack-signature');
    if (signature) {
      const raw = await req.text();
      if (!PAYSTACK_KEY || !/^[a-f0-9]{128}$/i.test(signature) || !safeEqual(await hmacHex(PAYSTACK_KEY, raw), signature.toLowerCase())) {
        return json({ error: 'Invalid signature' }, 401);
      }
      const event = JSON.parse(raw);
      const reference = String(event?.data?.reference || '');
      if (event.event !== 'charge.success') return json({ received: true });
      // Errors throw → non-2xx, so Paystack retries.
      if (reference.startsWith('OPPAY-')) await settle(reference);
      else if (reference.startsWith('OBSUB-')) await settleSubscription(reference);
      return json({ received: true });
    }

    const body = await req.json().catch(() => ({}));
    const api = asUser(req);

    // ---------- Mobile Money providers for payout setup ----------
    if (body.action === 'banks') {
      await api('GET', '/payments/payout'); // owners only
      const banks = await paystack('/bank?currency=GHS&type=mobile_money');
      return json(banks.map((b: { name: string; code: string }) => ({ name: b.name, code: b.code })));
    }

    // ---------- Owner saves where the shop gets paid (creates/updates the Paystack subaccount) ----------
    if (body.action === 'save-payout') {
      const me = await api<{ id: string; businessId: string; businessName: string; staffRole?: string }>('GET', '/auth/me');
      if (me.staffRole !== 'OWNER') throw new HttpError(403, 'Only the shop owner can do this');
      const settlementBank = String(body.settlementBank || '').trim();
      const accountNumber = String(body.accountNumber || '').replace(/\s+/g, '');
      const accountName = String(body.accountName || '').trim().slice(0, 80);
      if (!settlementBank || !/^\+?\d{9,15}$/.test(accountNumber)) throw new HttpError(400, 'Choose a provider and enter a valid number.');
      const banks = await paystack('/bank?currency=GHS&type=mobile_money');
      const provider = banks.find((b: { code: string }) => b.code === settlementBank);
      if (!provider) throw new HttpError(400, 'Unknown Mobile Money provider.');
      const existing = await internal('payout', { businessId: me.businessId });
      const details = {
        business_name: me.businessName, settlement_bank: settlementBank, account_number: accountNumber,
        percentage_charge: FEE_PERCENT, description: `OrderBook shop ${me.businessId}`,
        primary_contact_name: accountName || undefined,
      };
      const sub = existing?.subaccountCode
        ? await paystack(`/subaccount/${encodeURIComponent(existing.subaccountCode)}`, { method: 'PUT', body: JSON.stringify(details) })
        : await paystack('/subaccount', { method: 'POST', body: JSON.stringify(details) });
      await internal('save_payout', {
        businessId: me.businessId, actorId: me.id, subaccountCode: sub.subaccount_code || existing?.subaccountCode,
        settlementBank, settlementName: provider.name, accountNumber, accountName: accountName || sub.account_name || null,
      });
      return json({ saved: true });
    }

    // ---------- Customer starts a payment ----------
    if (body.action === 'initialize') {
      const orderId = String(body.orderId || '');
      const page = await api<{ onlinePayments: boolean; customerPhone: string }>('GET', `/payments/order/${encodeURIComponent(orderId)}`);
      if (!page.onlinePayments) throw new HttpError(400, 'This shop has not set up online payments yet.');
      const attempt = await api<{ internalReference: string; amount: string }>('POST', '/payments/initiate', {
        orderId, amount: body.amount, network: body.network, momoPhone: body.momoPhone,
      });
      const info = await internal('attempt', { reference: attempt.internalReference });
      const callback = new URL(String(body.returnUrl || ''));
      if (!['https:', 'http:'].includes(callback.protocol)) throw new HttpError(400, 'Invalid return address.');
      callback.searchParams.set('order', orderId);
      try {
        const tx = await paystack('/transaction/initialize', {
          method: 'POST',
          body: JSON.stringify({
            email: `p${String(page.customerPhone).replace(/\D/g, '')}@phone.orderbook.app`,
            amount: info.amountPesewas, currency: 'GHS', reference: attempt.internalReference,
            channels: ['mobile_money'], subaccount: info.subaccountCode, bearer: 'subaccount',
            callback_url: callback.toString(),
            metadata: { orderId, businessId: info.businessId, source: 'orderbook' },
          }),
        });
        return json({ authorizationUrl: tx.authorization_url, reference: attempt.internalReference });
      } catch (e) {
        await internal('fail', { reference: attempt.internalReference, reason: e instanceof Error ? e.message : 'Could not start payment' });
        throw e;
      }
    }

    // ---------- Back from Paystack: check and record ----------
    if (body.action === 'verify') {
      const reference = String(body.reference || '');
      if (!/^OPPAY-[A-Z0-9]{16}$/.test(reference)) throw new HttpError(400, 'Invalid payment reference.');
      const info = await internal('attempt', { reference });
      await api('GET', `/payments/order/${encodeURIComponent(info.orderId)}`); // caller must be allowed to see this order
      if (info.receiptId) return json({ status: 'success', paymentId: info.receiptId });
      return json(await settle(reference));
    }

    // ---------- Owner pays the OrderBook subscription ----------
    if (body.action === 'subscribe') {
      const me = await api<{ id: string; businessId: string; businessName: string; staffRole?: string; phone: string }>('GET', '/auth/me');
      if (me.staffRole !== 'OWNER') throw new HttpError(403, 'Only the shop owner can do this');
      const months = Number(body.months);
      if (months !== 1 && months !== 12) throw new HttpError(400, 'Choose monthly or yearly.');
      const sub = await billing('start', { businessId: me.businessId, months, actorId: me.id });
      const callback = new URL(String(body.returnUrl || ''));
      if (!['https:', 'http:'].includes(callback.protocol)) throw new HttpError(400, 'Invalid return address.');
      callback.searchParams.set('billing', '1');
      try {
        const tx = await paystack('/transaction/initialize', {
          method: 'POST',
          body: JSON.stringify({
            email: `p${String(me.phone).replace(/\D/g, '')}@phone.orderbook.app`,
            amount: sub.amountPesewas, currency: 'GHS', reference: sub.reference,
            channels: ['mobile_money', 'card'], callback_url: callback.toString(),
            metadata: { businessId: me.businessId, months, source: 'orderbook-subscription' },
          }),
        });
        return json({ authorizationUrl: tx.authorization_url, reference: sub.reference });
      } catch (e) {
        await billing('fail', { reference: sub.reference, reason: e instanceof Error ? e.message : 'Could not start payment' });
        throw e;
      }
    }

    if (body.action === 'subscription-verify') {
      const reference = String(body.reference || '');
      if (!/^OBSUB-[A-Z0-9]{16}$/.test(reference)) throw new HttpError(400, 'Invalid payment reference.');
      const me = await api<{ businessId: string; staffRole?: string }>('GET', '/auth/me');
      const sp = await billing('get', { reference });
      if (me.staffRole !== 'OWNER' || sp.businessId !== me.businessId) throw new HttpError(403, 'Only the shop owner can do this');
      if (sp.status === 'SUCCESS') return json({ status: 'success' });
      return json(await settleSubscription(reference));
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected payment error.' }, status);
  }
});
