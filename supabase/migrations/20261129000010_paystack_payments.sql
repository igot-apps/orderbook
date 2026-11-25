-- OrderBook — Phase 4: real Mobile Money payments through Paystack.
--  * Each shop has a Paystack subaccount; customers' money settles straight to the shop's MoMo/bank.
--  * The Paystack secret key lives only in the Edge Function (supabase/functions/paystack). The database
--    never calls Paystack; the function verifies every charge with Paystack and then calls
--    public.paystack_internal (service role only) to record it.
--  * The old simulated checkout is OFF unless AppConfig.simulate_payments = 'true' (staging/tests).

create table if not exists "PayoutAccount" (
  "businessId" text primary key references "Business"(id) on delete cascade,
  "subaccountCode" text not null unique,
  "settlementBank" text not null,        -- Paystack bank/MoMo provider code
  "settlementName" text,                 -- provider name shown to the owner
  "accountNumber" text not null,
  "accountName" text,
  "updatedAt" timestamp(3) not null default (now() at time zone 'utc')
);
alter table "PayoutAccount" enable row level security;
revoke all on "PayoutAccount" from anon, authenticated;

create table if not exists "AppConfig" (key text primary key, value text not null);
alter table "AppConfig" enable row level security;
revoke all on "AppConfig" from anon, authenticated;

create or replace function app.simulation_on() returns boolean language sql stable as $$
  select coalesce((select value = 'true' from "AppConfig" where key = 'simulate_payments'), false)
$$;

-- POST /payments/checkout — simulated success, only where simulation is switched on.
create or replace function app.checkout(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare att jsonb;
begin
  perform app.need_role(me, 'CUSTOMER');
  if not app.simulation_on() then perform app.err(400, 'Pay with Mobile Money through Paystack'); end if;
  perform app.payment_page(me, b->>'orderId');
  att := app.initiate_payment(me, b);
  return app.process_success(att->>'internalReference', 'SIM-' || (att->>'internalReference'));
end $$;

-- GET /payments/order/:id — now also says how this order can be paid.
create or replace function app.payment_page(me app.ctx, p_order text) returns jsonb language plpgsql stable as $$
declare o "Order"; c "Customer"; bz "Business";
begin
  select * into o from "Order" where id = p_order;
  if not found then perform app.err(404, 'Order not found'); end if;
  if o."agreedTotal" is null or o.status::text not in ('AGREED','DELIVERED','COMPLETED') then
    perform app.err(400, 'Order is not ready for payment');
  end if;
  if me.business_id <> o."businessId" or (me.role = 'CUSTOMER' and me.customer_id is distinct from o."customerId") then
    perform app.err(403, 'This order belongs to another account');
  end if;
  select * into c from "Customer" where id = o."customerId";
  select * into bz from "Business" where id = o."businessId";
  return jsonb_build_object(
    'orderId', o.id, 'businessId', o."businessId", 'customerId', o."customerId", 'orderNumber', o."orderNumber",
    'businessName', bz.name, 'customerName', c.name, 'customerPhone', c.phone, 'status', o.status,
    'finalTotal', round(o."agreedTotal", 2)::text, 'amountPaid', round(o."amountPaid", 2)::text,
    'outstandingBalance', round(o."outstandingBalance", 2)::text, 'isPaid', o."isPaid",
    'onlinePayments', exists (select 1 from "PayoutAccount" where "businessId" = o."businessId"),
    'simulatedPayments', app.simulation_on(),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', round(p.amount, 2)::text, 'network', p.network,
                   'receiptNumber', p."receiptNumber", 'paidAt', p."paidAt", 'providerReference', p."providerReference") order by p."paidAt" desc), '[]')
                 from "Payment" p where p."orderId" = o.id),
    'recentAttempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'internalReference', a."internalReference",
                   'amount', round(a.amount, 2)::text, 'status', a.status, 'network', a.network, 'createdAt', a."createdAt") order by a."createdAt" desc), '[]')
                 from (select * from "PaymentAttempt" where "orderId" = o.id order by "createdAt" desc limit 5) a));
end $$;

-- GET /payments/payout — the shop's settlement details (owner only, number masked).
create or replace function app.payout_status(me app.ctx) returns jsonb language plpgsql stable as $$
declare p "PayoutAccount";
begin
  perform app.need_owner(me);
  select * into p from "PayoutAccount" where "businessId" = me.business_id;
  if not found then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object('configured', true, 'settlementBank', p."settlementBank", 'settlementName', p."settlementName",
    'accountNumber', repeat('•', greatest(length(p."accountNumber") - 4, 0)) || right(p."accountNumber", 4),
    'accountName', p."accountName", 'updatedAt', p."updatedAt");
end $$;

-- ---------- Service-role entry point for the Paystack Edge Function ----------
create or replace function public.paystack_internal(p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare a "PaymentAttempt"; po "PayoutAccount"; r jsonb;
begin
  if p_action = 'attempt' then
    select * into a from "PaymentAttempt" where "internalReference" = p_args->>'reference';
    if not found then perform app.err(404, 'Payment attempt not found'); end if;
    select * into po from "PayoutAccount" where "businessId" = a."businessId";
    return jsonb_build_object('orderId', a."orderId", 'businessId', a."businessId", 'status', a.status,
      'amountPesewas', (round(a.amount, 2) * 100)::bigint, 'subaccountCode', po."subaccountCode",
      'receiptId', (select p.id from "Payment" p where p."attemptId" = a.id));
  end if;

  if p_action = 'payout' then
    select * into po from "PayoutAccount" where "businessId" = p_args->>'businessId';
    return case when found then to_jsonb(po) else 'null'::jsonb end;
  end if;

  if p_action = 'save_payout' then
    insert into "PayoutAccount" ("businessId", "subaccountCode", "settlementBank", "settlementName", "accountNumber", "accountName", "updatedAt")
    values (p_args->>'businessId', p_args->>'subaccountCode', p_args->>'settlementBank', p_args->>'settlementName',
            p_args->>'accountNumber', p_args->>'accountName', now() at time zone 'utc')
    on conflict ("businessId") do update set "subaccountCode" = excluded."subaccountCode", "settlementBank" = excluded."settlementBank",
      "settlementName" = excluded."settlementName", "accountNumber" = excluded."accountNumber",
      "accountName" = excluded."accountName", "updatedAt" = excluded."updatedAt";
    perform app.audit(p_args->>'businessId', p_args->>'actorId', 'PayoutAccount', p_args->>'businessId', 'PAYOUT_SAVED',
      jsonb_build_object('settlementBank', p_args->>'settlementBank', 'last4', right(p_args->>'accountNumber', 4)));
    return jsonb_build_object('saved', true);
  end if;

  -- Called only after the Edge Function has fetched the transaction from Paystack itself.
  if p_action = 'confirm' then
    select * into a from "PaymentAttempt" where "internalReference" = p_args->>'reference' for update;
    if not found then perform app.err(404, 'Payment attempt not found'); end if;
    if exists (select 1 from "Payment" where "attemptId" = a.id) then
      return app.process_success(a."internalReference", p_args->>'providerReference');
    end if;
    if p_args->>'status' is distinct from 'success' then perform app.err(400, 'Payment is not successful'); end if;
    if p_args->>'currency' is distinct from 'GHS' then perform app.err(400, 'Payment currency does not match'); end if;
    if (p_args->>'amountPesewas')::bigint is distinct from (round(a.amount, 2) * 100)::bigint then
      perform app.err(400, 'Paid amount does not match this payment');
    end if;
    select * into po from "PayoutAccount" where "businessId" = a."businessId";
    if po."subaccountCode" is null or p_args->>'subaccountCode' is distinct from po."subaccountCode" then
      perform app.err(400, 'Payment was not made to this shop');
    end if;
    r := app.process_success(a."internalReference", p_args->>'providerReference');
    update "PaymentAttempt" set "webhookPayload" = coalesce("webhookPayload", '{}'::jsonb) || jsonb_build_object('channel', p_args->>'channel', 'paidAt', p_args->>'paidAt')
     where id = a.id;
    return r;
  end if;

  if p_action = 'fail' then
    update "PaymentAttempt" set status = 'FAILED', "failureReason" = left(coalesce(p_args->>'reason', 'Payment failed'), 200),
           "completedAt" = app.now_utc()
     where "internalReference" = p_args->>'reference' and status = 'PENDING';
    return jsonb_build_object('updated', found);
  end if;

  perform app.err(400, 'Unknown action');
  return null;
end $$;

revoke execute on function public.paystack_internal(text, jsonb) from public, anon, authenticated;
grant execute on function public.paystack_internal(text, jsonb) to service_role;

-- ---------- Router: add GET /payments/payout ----------
do $$
declare src text;
begin
  select pg_get_functiondef('public.api(text, text, jsonb, jsonb)'::regprocedure) into src;
  if position('app.payout_status' in src) = 0 then
    src := replace(src,
      $r$    if m = 'GET' and n = 1 then return app.list_payments(me); end if;$r$,
      $r$    if m = 'GET' and n = 1 then return app.list_payments(me); end if;
    if m = 'GET' and n = 2 and s[2] = 'payout' then return app.payout_status(me); end if;$r$);
    if position('app.payout_status' in src) = 0 then raise exception 'router patch failed'; end if;
    execute src;
  end if;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
