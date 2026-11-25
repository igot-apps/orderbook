-- OrderBook — Phase 5: shops pay OrderBook a subscription (GH₵50/month or GH₵500/year) through Paystack.
--  * 30-day free trial from when the shop was created (existing shops: 30 days from this migration).
--  * After the paid/trial period: 7 days of grace, then the shop is read-only: no new orders, customers
--    or staff, but everything stays visible and customers can still pay existing orders.
--  * Subscription money goes to OrderBook's own Paystack account (no subaccount). Charges are recorded
--    only by the Paystack Edge Function after it has verified them (public.paystack_internal).

create table if not exists "Subscription" (
  "businessId" text primary key references "Business"(id) on delete cascade,
  "trialEndsAt" timestamptz not null,
  "paidUntil" timestamptz,
  "updatedAt" timestamptz not null default now()
);
alter table "Subscription" enable row level security;
revoke all on "Subscription" from anon, authenticated;

create table if not exists "SubscriptionPayment" (
  id text primary key default gen_random_uuid()::text,
  "businessId" text not null references "Business"(id) on delete cascade,
  reference text not null unique,
  months int not null check (months in (1, 12)),
  amount numeric(12, 2) not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'FAILED')),
  "providerReference" text unique,
  "failureReason" text,
  "createdBy" text,
  "createdAt" timestamptz not null default now(),
  "paidAt" timestamptz
);
create index if not exists "SubscriptionPayment_business_idx" on "SubscriptionPayment" ("businessId", "createdAt" desc);
alter table "SubscriptionPayment" enable row level security;
revoke all on "SubscriptionPayment" from anon, authenticated;

-- Existing shops start a fresh 30-day trial today.
insert into "Subscription" ("businessId", "trialEndsAt")
select id, now() + interval '30 days' from "Business"
on conflict ("businessId") do nothing;

create or replace function app.plan_price(p_months int) returns numeric language sql immutable as $$
  select case p_months when 1 then 50.00 when 12 then 500.00 end
$$;

-- Shops created after this migration have no row yet: their trial runs 30 days from creation.
create or replace function app.sub_state(p_biz text) returns jsonb language plpgsql stable as $$
declare s "Subscription"; v_trial timestamptz; v_until timestamptz; v_status text;
begin
  select * into s from "Subscription" where "businessId" = p_biz;
  v_trial := coalesce(s."trialEndsAt", (select ("createdAt" at time zone 'utc') + interval '30 days' from "Business" where id = p_biz));
  v_until := greatest(v_trial, coalesce(s."paidUntil", v_trial));
  v_status := case
    when now() < v_until and coalesce(s."paidUntil", '-infinity') >= v_until then 'ACTIVE'
    when now() < v_until then 'TRIAL'
    when now() < v_until + interval '7 days' then 'GRACE'
    else 'EXPIRED' end;
  return jsonb_build_object('status', v_status, 'activeUntil', v_until,
    'graceEndsAt', v_until + interval '7 days',
    'daysLeft', greatest(0, ceil(extract(epoch from (v_until - now())) / 86400))::int);
end $$;

create or replace function app.need_active_shop(me app.ctx) returns void language plpgsql stable as $$
begin
  if app.sub_state(me.business_id)->>'status' = 'EXPIRED' then
    if me.role = 'CUSTOMER' then
      perform app.err(402, 'This shop is not taking new orders right now. Please contact the shop.');
    end if;
    perform app.err(402, 'Your OrderBook subscription has ended. Renew it in More → Subscription to continue.');
  end if;
end $$;

-- GET /billing/status — any seller (banner); GET /billing — owner (plans and history).
create or replace function app.billing_status(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'SELLER');
  return app.sub_state(me.business_id);
end $$;

create or replace function app.billing(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_owner(me);
  return app.sub_state(me.business_id) || jsonb_build_object(
    'plans', jsonb_build_array(
      jsonb_build_object('months', 1, 'label', 'Monthly', 'amount', '50.00'),
      jsonb_build_object('months', 12, 'label', 'Yearly', 'amount', '500.00', 'note', '2 months free')),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('reference', p.reference, 'months', p.months,
        'amount', p.amount::text, 'status', p.status, 'createdAt', p."createdAt", 'paidAt', p."paidAt") order by p."createdAt" desc), '[]')
      from (select * from "SubscriptionPayment" where "businessId" = me.business_id order by "createdAt" desc limit 24) p));
end $$;

-- ---------- Service-role actions used by the Paystack Edge Function ----------
create or replace function public.billing_internal(p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare sp "SubscriptionPayment"; v_ref text; v_amount numeric; v_from timestamptz; v_until timestamptz;
begin
  if p_action = 'start' then
    v_amount := app.plan_price((p_args->>'months')::int);
    if v_amount is null then perform app.err(400, 'Choose monthly or yearly'); end if;
    v_ref := 'OBSUB-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 16));
    insert into "SubscriptionPayment" ("businessId", reference, months, amount, "createdBy")
    values (p_args->>'businessId', v_ref, (p_args->>'months')::int, v_amount, p_args->>'actorId') returning * into sp;
    return jsonb_build_object('reference', sp.reference, 'amountPesewas', (sp.amount * 100)::bigint, 'businessId', sp."businessId");
  end if;

  if p_action = 'get' then
    select * into sp from "SubscriptionPayment" where reference = p_args->>'reference';
    if not found then perform app.err(404, 'Subscription payment not found'); end if;
    return to_jsonb(sp);
  end if;

  if p_action = 'fail' then
    update "SubscriptionPayment" set status = 'FAILED', "failureReason" = left(coalesce(p_args->>'reason', 'Payment failed'), 200)
     where reference = p_args->>'reference' and status = 'PENDING';
    return jsonb_build_object('updated', found);
  end if;

  -- Only after the Edge Function fetched the transaction from Paystack itself.
  if p_action = 'confirm' then
    select * into sp from "SubscriptionPayment" where reference = p_args->>'reference' for update;
    if not found then perform app.err(404, 'Subscription payment not found'); end if;
    if sp.status = 'SUCCESS' then return app.sub_state(sp."businessId") || jsonb_build_object('idempotent', true); end if;
    if p_args->>'status' is distinct from 'success' then perform app.err(400, 'Payment is not successful'); end if;
    if p_args->>'currency' is distinct from 'GHS' then perform app.err(400, 'Payment currency does not match'); end if;
    if (p_args->>'amountPesewas')::bigint is distinct from (sp.amount * 100)::bigint then
      perform app.err(400, 'Paid amount does not match this plan');
    end if;
    if coalesce(p_args->>'subaccountCode', '') <> '' then perform app.err(400, 'Subscription was paid to the wrong account'); end if;
    insert into "Subscription" ("businessId", "trialEndsAt")
    select sp."businessId", (b."createdAt" at time zone 'utc') + interval '30 days' from "Business" b where b.id = sp."businessId"
    on conflict ("businessId") do nothing;
    -- New time starts when the current paid/trial period ends (or now, if it already ended).
    v_from := greatest(now(), ((app.sub_state(sp."businessId"))->>'activeUntil')::timestamptz);
    v_until := v_from + make_interval(months => sp.months);
    update "Subscription" set "paidUntil" = v_until, "updatedAt" = now() where "businessId" = sp."businessId";
    update "SubscriptionPayment" set status = 'SUCCESS', "providerReference" = p_args->>'providerReference', "paidAt" = now()
     where id = sp.id;
    perform app.audit(sp."businessId", sp."createdBy", 'Subscription', sp."businessId", 'RENEWED',
      jsonb_build_object('months', sp.months, 'amount', sp.amount::text, 'paidUntil', v_until));
    return app.sub_state(sp."businessId") || jsonb_build_object('idempotent', false);
  end if;

  perform app.err(400, 'Unknown action');
  return null;
end $$;

revoke execute on function public.billing_internal(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_internal(text, jsonb) to service_role;

-- ---------- Router: billing routes + read-only enforcement ----------
do $$
declare src text;
begin
  select replace(pg_get_functiondef('public.api(text, text, jsonb, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  if position('app.need_active_shop' in src) = 0 then
    src := replace(src,
      $r$  case s[1]
  when 'auth' then$r$,
      $r$  -- Expired shops are read-only: no new orders, customers or staff.
  if m = 'POST' and n = 1 and s[1] in ('orders', 'customers', 'staff') then perform app.need_active_shop(me); end if;

  case s[1]
  when 'billing' then
    if m = 'GET' and n = 1 then return app.billing(me); end if;
    if m = 'GET' and n = 2 and s[2] = 'status' then return app.billing_status(me); end if;

  when 'auth' then$r$);
    if position('app.need_active_shop' in src) = 0 then raise exception 'router patch failed'; end if;
    execute src;
  end if;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
