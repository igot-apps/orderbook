-- OrderBook on Supabase — part 1: auth link, defaults, helpers, JSON serializers.
-- The browser never touches tables directly. It calls public.api(...) (see part 3),
-- a SECURITY DEFINER function that enforces roles, ownership and all business rules.

create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- ---------- Link app users to Supabase Auth ----------
alter table "User" add column if not exists "authUserId" uuid unique;

-- ---------- Column defaults so SQL inserts don't need Prisma ----------
do $$
declare t text;
begin
  foreach t in array array['AuditLog','Business','BusinessSettings','Customer','CustomerFavourite','Delivery',
    'Notification','Order','OrderAgreement','OrderRequestItem','OrderRevision','OrderRevisionItem','Payment',
    'PaymentAllocation','PaymentAttempt','Product','ProductPrice','ProductVariant','User'] loop
    execute format('alter table %I alter column id set default gen_random_uuid()::text', t);
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='updatedAt') then
      execute format('alter table %I alter column "updatedAt" set default (now() at time zone ''utc'')', t);
    end if;
  end loop;
end $$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin
  new."updatedAt" := (now() at time zone 'utc');
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['Business','Customer','Delivery','Order','PaymentAttempt','Product','ProductVariant','User'] loop
    execute format('drop trigger if exists touch_updated_at on %I', t);
    execute format('create trigger touch_updated_at before update on %I for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ---------- Basic helpers ----------
create or replace function app.now_utc() returns timestamp(3) language sql stable as $$
  select (now() at time zone 'utc')::timestamp(3)
$$;

create or replace function app.err(p_status int, p_msg text) returns void language plpgsql as $$
begin
  raise exception using message = p_msg, hint = p_status::text, errcode = 'P0001';
end $$;

create or replace function app.num(j jsonb) returns numeric language plpgsql immutable as $$
begin
  if j is null or j = 'null'::jsonb then return null; end if;
  return (j #>> '{}')::numeric;
exception when invalid_text_representation then
  perform app.err(400, 'Invalid number');
end $$;

create or replace function app.bool(j jsonb) returns boolean language sql immutable as $$
  select case when jsonb_typeof(j) = 'boolean' then (j #>> '{}')::boolean else null end
$$;

create or replace function app.txt(j jsonb) returns text language sql immutable as $$
  select case when j is null or j = 'null'::jsonb then null else j #>> '{}' end
$$;

create or replace function app.blank(t text) returns boolean language sql immutable as $$
  select t is null or btrim(t) = ''
$$;

create or replace function app.iso(ts timestamp) returns text language sql immutable as $$
  select to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create or replace function app.ghs(v numeric) returns text language sql immutable as $$
  select 'GH₵' || round(v, 2)::text
$$;

-- Convert numeric JSON fields to fixed-decimal strings, matching the old API ("12.00", "1.2500").
create or replace function app.fix(j jsonb, money_keys text[], qty_keys text[] default '{}') returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k,
    case
      when jsonb_typeof(v) = 'number' and k = any(money_keys) then to_jsonb(round((v #>> '{}')::numeric, 2)::text)
      when jsonb_typeof(v) = 'number' and k = any(qty_keys) then to_jsonb(round((v #>> '{}')::numeric, 4)::text)
      else v
    end), '{}'::jsonb)
  from jsonb_each(j) as e(k, v)
$$;

-- ---------- Current user ----------
drop type if exists app.ctx cascade;
create type app.ctx as (id text, business_id text, role text, phone text, name text, customer_id text);

create or replace function app.me() returns app.ctx language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare r app.ctx;
begin
  select u.id, u."businessId", u.role::text, u.phone, u.name, c.id
    into r
    from "User" u left join "Customer" c on c."userId" = u.id
   where u."authUserId" = auth.uid() and u."isActive";
  if r.id is null then perform app.err(401, 'Session expired. Please sign in again.'); end if;
  return r;
end $$;

create or replace function app.need_role(me app.ctx, p_role text) returns void language plpgsql as $$
begin
  if me.role <> p_role then perform app.err(403, 'Insufficient role'); end if;
end $$;

-- ---------- Order state machine ----------
create or replace function app.can_transition(f text, t text) returns boolean language sql immutable as $$
  select t = any (case f
    when 'DRAFT' then array['SUBMITTED','CANCELLED']
    when 'SUBMITTED' then array['PREPARING','CANCELLED']
    when 'PREPARING' then array['AWAITING_CUSTOMER_APPROVAL','AGREED','CHANGE_REQUESTED','CANCELLED']
    when 'AWAITING_CUSTOMER_APPROVAL' then array['AGREED','CHANGE_REQUESTED','PREPARING','CANCELLED']
    when 'CHANGE_REQUESTED' then array['PREPARING','CANCELLED']
    when 'AGREED' then array['PREPARING','CHANGE_REQUESTED','DELIVERED','CANCELLED']
    when 'READY_FOR_DELIVERY' then array['DISPATCHED','CANCELLED']
    when 'DISPATCHED' then array['DELIVERED','CANCELLED']
    when 'DELIVERED' then array['COMPLETED']
    else array[]::text[] end)
$$;

create or replace function app.assert_transition(f text, t text) returns void language plpgsql as $$
begin
  if not app.can_transition(f, t) then
    perform app.err(400, format('Invalid order status transition: %s → %s', f, t));
  end if;
end $$;

-- ---------- Audit + notifications ----------
create or replace function app.audit(p_biz text, p_actor text, p_type text, p_id text, p_action text, p_details jsonb default null)
returns void language sql as $$
  insert into "AuditLog" ("businessId","actorId","entityType","entityId","action","details")
  values (p_biz, p_actor, p_type, p_id, p_action, p_details)
$$;

create or replace function app.notify(p_biz text, p_phone text, p_type text, p_msg text, p_order text, p_payment text, p_link text)
returns void language sql as $$
  insert into "Notification" ("businessId","recipientPhone","type","message","orderId","paymentId","linkPath","status","sentAt")
  values (p_biz, p_phone, p_type::"NotificationType", p_msg, p_order, p_payment, p_link, 'SENT', app.now_utc())
$$;

-- ---------- Supabase Auth accounts (phone + password, no SMS) ----------
create or replace function app.phone_email(p_phone text) returns text language sql immutable as $$
  select 'p' || regexp_replace(p_phone, '\D', '', 'g') || '@phone.orderbook.app'
$$;

create or replace function app.create_auth_user(p_phone text, p_password_hash text) returns uuid
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare uid uuid := gen_random_uuid(); em text := app.phone_email(p_phone);
begin
  if exists (select 1 from auth.users where email = em) then
    perform app.err(409, 'This phone number is already registered');
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token,
    reauthentication_token, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em, p_password_hash, now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '', '', '', '', '', false, false);
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true), 'email', now(), now(), now());
  return uid;
end $$;

-- ---------- JSON serializers (same shapes as the old Express API) ----------
create or replace function app.j_order(o "Order") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(o), array['estimatedDeliveryCharge','requestedItemsTotal','estimatedTotal','agreedTotal','amountPaid','outstandingBalance'])
$$;

create or replace function app.j_req_item(i "OrderRequestItem") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(i), array['catalogueUnitPrice','requestedAmount'], array['estimatedQuantity'])
$$;

create or replace function app.j_rev_item(i "OrderRevisionItem") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(i), array['catalogueUnitPrice','confirmedUnitPrice','requestedAmount','actualLineTotal','differenceAmount'],
                 array['estimatedQuantity','actualQuantity'])
$$;

create or replace function app.j_agreement(a "OrderAgreement") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(a), array['agreedTotal'])
$$;

create or replace function app.j_person(p_user_id text) returns jsonb language sql stable as $$
  select jsonb_build_object('id', u.id, 'name', u.name) from "User" u where u.id = p_user_id
$$;

create or replace function app.j_rev(r "OrderRevision", with_items boolean, with_people boolean) returns jsonb language sql stable as $$
  select app.fix(to_jsonb(r), array['deliveryCharge','itemsTotal','grandTotal','requestedTotal','differenceAmount','differencePercent'])
    || case when with_items then jsonb_build_object('items',
         (select coalesce(jsonb_agg(app.j_rev_item(i) order by i."sortOrder"), '[]') from "OrderRevisionItem" i where i."revisionId" = r.id))
       else '{}'::jsonb end
    || jsonb_build_object('agreement',
         (select app.j_agreement(a) || case when with_people then jsonb_build_object('recordedBy', app.j_person(a."recordedById")) else '{}'::jsonb end
            from "OrderAgreement" a where a."revisionId" = r.id))
    || case when with_people then jsonb_build_object('preparedBy', app.j_person(r."preparedById")) else '{}'::jsonb end
$$;

create or replace function app.j_latest_rev(p_order text, with_items boolean) returns jsonb language sql stable as $$
  select coalesce((select jsonb_agg(app.j_rev(r, with_items, false)) from (
    select * from "OrderRevision" where "orderId" = p_order order by "revisionNumber" desc limit 1) r), '[]')
$$;

create or replace function app.j_variant(v "ProductVariant") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(v), array['unitPrice'])
$$;

create or replace function app.j_attempt(a "PaymentAttempt") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(a), array['amount'])
$$;

create or replace function app.j_payment(p "Payment") returns jsonb language sql stable as $$
  select app.fix(to_jsonb(p), array['amount'])
$$;

create or replace function app.j_product(p "Product", p_customer text, active_only boolean default true) returns jsonb language sql stable as $$
  select to_jsonb(p) || jsonb_build_object(
    'variants', (select coalesce(jsonb_agg(app.j_variant(v) order by v.name), '[]') from "ProductVariant" v
                  where v."productId" = p.id and (not active_only or v."isActive")),
    'isFavourite', exists (select 1 from "CustomerFavourite" f where f."productId" = p.id and f."customerId" = p_customer))
$$;
