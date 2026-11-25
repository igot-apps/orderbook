-- OrderBook — Phase 6: platform super-admin.
--  * "PlatformAdmin" lists the sign-ins (Account ids) that run OrderBook. Granted only with SQL; no screen can grant it.
--  * Admins can list every shop, gift subscription days, suspend/unsuspend a shop, and see revenue by month.
--  * A suspended shop is read-only exactly like an expired one (no new orders, customers or staff).

create table if not exists "PlatformAdmin" (
  "accountId" uuid primary key references "Account"(id) on delete cascade,
  "createdAt" timestamptz not null default now()
);
alter table "PlatformAdmin" enable row level security;
revoke all on "PlatformAdmin" from anon, authenticated;

alter table "Business" add column if not exists "suspendedAt" timestamptz;
alter table "Business" add column if not exists "suspendReason" text;

create or replace function app.is_admin() returns boolean language sql stable as $$
  select exists (select 1 from "PlatformAdmin" where "accountId" = auth.uid())
$$;

create or replace function app.need_admin() returns void language plpgsql stable as $$
begin
  if not app.is_admin() then perform app.err(403, 'Only OrderBook administrators can do this'); end if;
end $$;

-- Subscription state now also says whether OrderBook suspended the shop.
create or replace function app.sub_state(p_biz text) returns jsonb language plpgsql stable as $$
declare s "Subscription"; v_trial timestamptz; v_until timestamptz; v_status text; v_susp timestamptz;
begin
  select * into s from "Subscription" where "businessId" = p_biz;
  select "suspendedAt" into v_susp from "Business" where id = p_biz;
  v_trial := coalesce(s."trialEndsAt", (select ("createdAt" at time zone 'utc') + interval '30 days' from "Business" where id = p_biz));
  v_until := greatest(v_trial, coalesce(s."paidUntil", v_trial));
  v_status := case
    when now() < v_until and coalesce(s."paidUntil", '-infinity') >= v_until then 'ACTIVE'
    when now() < v_until then 'TRIAL'
    when now() < v_until + interval '7 days' then 'GRACE'
    else 'EXPIRED' end;
  return jsonb_build_object('status', v_status, 'activeUntil', v_until,
    'graceEndsAt', v_until + interval '7 days',
    'daysLeft', greatest(0, ceil(extract(epoch from (v_until - now())) / 86400))::int,
    'suspended', v_susp is not null);
end $$;

create or replace function app.need_active_shop(me app.ctx) returns void language plpgsql stable as $$
declare st jsonb := app.sub_state(me.business_id);
begin
  if (st->>'suspended')::boolean then
    if me.role = 'CUSTOMER' then
      perform app.err(402, 'This shop is not taking new orders right now. Please contact the shop.');
    end if;
    perform app.err(402, 'This shop has been suspended by OrderBook. Please contact OrderBook support.');
  end if;
  if st->>'status' = 'EXPIRED' then
    if me.role = 'CUSTOMER' then
      perform app.err(402, 'This shop is not taking new orders right now. Please contact the shop.');
    end if;
    perform app.err(402, 'Your OrderBook subscription has ended. Renew it in More → Subscription to continue.');
  end if;
end $$;

-- /auth/me tells the app whether to show the admin screens.
create or replace function app.auth_me(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('id', me.id, 'name', me.name, 'phone', me.phone, 'role', me.role, 'businessId', me.business_id,
    'customerId', me.customer_id, 'staffRole', me.staff_role,
    'businessName', (select name from "Business" where id = me.business_id),
    'businessCount', (select count(*) from "User" where "authUserId" = auth.uid() and "isActive"),
    'business', (select jsonb_build_object('id', bz.id, 'name', bz.name, 'settings',
        (select app.fix(to_jsonb(s), array['approvalToleranceAbs','approvalTolerancePct','defaultDeliveryCharge'])
           from "BusinessSettings" s where s."businessId" = bz.id)) from "Business" bz where bz.id = me.business_id),
    'creditAllowed', (select c."creditAllowed" from "Customer" c where c.id = me.customer_id),
    'isAdmin', app.is_admin())
$$;

-- GET /admin/shops?search=
create or replace function app.admin_shops(q jsonb) returns jsonb language plpgsql stable as $$
declare v_search text := nullif(btrim(coalesce(q->>'search', '')), '');
begin
  perform app.need_admin();
  return (select coalesce(jsonb_agg(r order by (r->>'createdAt') desc), '[]') from (
    select jsonb_build_object(
      'id', b.id, 'name', b.name, 'createdAt', b."createdAt",
      'owner', (select jsonb_build_object('name', u.name, 'phone', u.phone) from "User" u
                 where u."businessId" = b.id and u."staffRole" = 'OWNER' order by u."createdAt" limit 1),
      'subscription', app.sub_state(b.id),
      'suspendedAt', b."suspendedAt", 'suspendReason', b."suspendReason",
      'orders', (select count(*) from "Order" o where o."businessId" = b.id),
      'customers', (select count(*) from "Customer" c where c."businessId" = b.id),
      'lastOrderAt', (select max(o."createdAt") from "Order" o where o."businessId" = b.id),
      'onlinePayments', exists (select 1 from "PayoutAccount" p where p."businessId" = b.id)) as r
    from "Business" b
    where v_search is null
       or b.name ilike '%' || v_search || '%'
       or exists (select 1 from "User" u where u."businessId" = b.id and u."staffRole" = 'OWNER' and u.phone like '%' || v_search || '%')
    order by b."createdAt" desc
    limit 500) t);
end $$;

-- GET /admin/overview
create or replace function app.admin_overview() returns jsonb language plpgsql stable as $$
declare v_states jsonb;
begin
  perform app.need_admin();
  select coalesce(jsonb_object_agg(st, cnt), '{}') into v_states from (
    select case when (s->>'suspended')::boolean then 'SUSPENDED' else s->>'status' end st, count(*) cnt
      from (select app.sub_state(id) s from "Business") x group by 1) y;
  return jsonb_build_object(
    'shops', (select count(*) from "Business"),
    'byStatus', v_states,
    'newShops30d', (select count(*) from "Business" where "createdAt" > (now() at time zone 'utc') - interval '30 days'),
    'subscriptionTotal', (select coalesce(sum(amount), 0)::text from "SubscriptionPayment" where status = 'SUCCESS'),
    'orderPaymentsTotal', (select coalesce(sum(amount), 0)::text from "Payment"),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(mo, 'YYYY-MM'),
        'subscriptions', (select coalesce(sum(amount), 0)::text from "SubscriptionPayment"
                           where status = 'SUCCESS' and date_trunc('month', "paidAt") = mo),
        'subscriptionCount', (select count(*) from "SubscriptionPayment"
                           where status = 'SUCCESS' and date_trunc('month', "paidAt") = mo),
        'orderPayments', (select coalesce(sum(amount), 0)::text from "Payment" where date_trunc('month', "paidAt") = mo),
        'orderPaymentCount', (select count(*) from "Payment" where date_trunc('month', "paidAt") = mo),
        'newShops', (select count(*) from "Business" where date_trunc('month', "createdAt") = mo)) order by mo desc), '[]')
      from generate_series(date_trunc('month', now() at time zone 'utc') - interval '11 months',
                           date_trunc('month', now() at time zone 'utc'), interval '1 month') mo));
end $$;

-- POST /admin/shops/:id/gift  { days, note }
create or replace function app.admin_gift(me app.ctx, p_biz text, b jsonb) returns jsonb language plpgsql as $$
declare v_days int; v_until timestamptz;
begin
  perform app.need_admin();
  if not exists (select 1 from "Business" where id = p_biz) then perform app.err(404, 'Shop not found'); end if;
  v_days := case when coalesce(b->>'days', '') ~ '^\d{1,3}$' then (b->>'days')::int end;
  if v_days is null or v_days < 1 or v_days > 366 then perform app.err(400, 'Enter between 1 and 366 days'); end if;
  insert into "Subscription" ("businessId", "trialEndsAt")
  select bz.id, (bz."createdAt" at time zone 'utc') + interval '30 days' from "Business" bz where bz.id = p_biz
  on conflict ("businessId") do nothing;
  v_until := greatest(now(), (app.sub_state(p_biz)->>'activeUntil')::timestamptz) + make_interval(days => v_days);
  update "Subscription" set "paidUntil" = v_until, "updatedAt" = now() where "businessId" = p_biz;
  perform app.audit(p_biz, me.id, 'Subscription', p_biz, 'GIFTED',
    jsonb_build_object('days', v_days, 'paidUntil', v_until, 'note', left(coalesce(b->>'note', ''), 200), 'by', auth.uid()));
  return app.sub_state(p_biz);
end $$;

-- POST /admin/shops/:id/suspend { reason }  ·  POST /admin/shops/:id/unsuspend
create or replace function app.admin_suspend(me app.ctx, p_biz text, b jsonb, p_on boolean) returns jsonb language plpgsql as $$
declare v_reason text := left(btrim(coalesce(b->>'reason', '')), 200);
begin
  perform app.need_admin();
  if not exists (select 1 from "Business" where id = p_biz) then perform app.err(404, 'Shop not found'); end if;
  if p_on and v_reason = '' then perform app.err(400, 'Give a reason for suspending this shop'); end if;
  update "Business" set "suspendedAt" = case when p_on then coalesce("suspendedAt", now()) end,
                        "suspendReason" = case when p_on then v_reason end
   where id = p_biz;
  perform app.audit(p_biz, me.id, 'Business', p_biz, case when p_on then 'SUSPENDED' else 'UNSUSPENDED' end,
    jsonb_build_object('reason', nullif(v_reason, ''), 'by', auth.uid()));
  return app.sub_state(p_biz);
end $$;

-- ---------- Router: admin routes ----------
do $$
declare src text;
begin
  select replace(pg_get_functiondef('public.api(text, text, jsonb, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  if position('app.admin_shops' in src) = 0 then
    src := replace(src,
      $r$  when 'billing' then$r$,
      $r$  when 'admin' then
    if m = 'GET' and n = 2 and s[2] = 'overview' then return app.admin_overview(); end if;
    if m = 'GET' and n = 2 and s[2] = 'shops' then return app.admin_shops(q); end if;
    if m = 'POST' and n = 4 and s[2] = 'shops' and s[4] = 'gift' then return app.admin_gift(me, s[3], b); end if;
    if m = 'POST' and n = 4 and s[2] = 'shops' and s[4] = 'suspend' then return app.admin_suspend(me, s[3], b, true); end if;
    if m = 'POST' and n = 4 and s[2] = 'shops' and s[4] = 'unsuspend' then return app.admin_suspend(me, s[3], b, false); end if;

  when 'billing' then$r$);
    if position('app.admin_shops' in src) = 0 then raise exception 'router patch failed'; end if;
    execute src;
  end if;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
