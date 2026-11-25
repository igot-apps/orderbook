-- OrderBook — Phase 2: one account, many shops.
--  * "Account" = one person's sign-in (Supabase auth user): PIN and password-change flag live here.
--  * "User" rows are now memberships: one per shop the person belongs to (seller owner/staff, or customer).
--  * The browser says which shop it is working in with the x-business-id header (per tab).

-- ---------- Accounts ----------
create table if not exists "Account" (
  id uuid primary key,                       -- = auth.users.id
  phone text not null unique,
  name text not null,
  "pinHash" text,
  "pinFailedCount" int not null default 0,
  "mustChangePassword" boolean not null default false,
  "createdAt" timestamp(3) not null default (now() at time zone 'utc')
);
alter table "Account" enable row level security;
revoke all on "Account" from anon, authenticated;

insert into "Account" (id, phone, name, "pinHash", "pinFailedCount", "mustChangePassword")
select distinct on (u."authUserId") u."authUserId", u.phone, u.name, u."pinHash", u."pinFailedCount", u."mustChangePassword"
  from "User" u where u."authUserId" is not null
 order by u."authUserId", u."createdAt"
on conflict (id) do nothing;

-- ---------- Memberships ----------
-- A person can now have one User row per shop, all sharing the same sign-in.
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con join pg_class t on t.oid = con.conrelid
            where t.relname = 'User' and con.contype = 'u'
              and pg_get_constraintdef(con.oid) = 'UNIQUE ("authUserId")' loop
    execute format('alter table "User" drop constraint %I', c);
  end loop;
end $$;
create index if not exists "User_authUserId_idx" on "User" ("authUserId");
alter table "User" add column if not exists "staffRole" text check ("staffRole" in ('OWNER', 'STAFF'));
alter table "User" add column if not exists "lastUsedAt" timestamp(3);
update "User" set "staffRole" = 'OWNER' where role = 'SELLER' and "staffRole" is null;


do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'app.ctx'::regclass and attname = 'staff_role' and not attisdropped) then
    alter type app.ctx add attribute staff_role text;
  end if;
end $$;

-- ---------- Who is calling, and in which shop ----------
create or replace function app.me() returns app.ctx language plpgsql stable security definer
set search_path = public, extensions, pg_temp as $$
declare r app.ctx; v_biz text := nullif(nullif(current_setting('request.headers', true), '')::json->>'x-business-id', '');
begin
  select u.id, u."businessId", u.role::text, u.phone, u.name, c.id, u."staffRole"
    into r
    from "User" u left join "Customer" c on c."userId" = u.id
   where u."authUserId" = auth.uid() and u."isActive" and (v_biz is null or u."businessId" = v_biz)
   order by u."lastUsedAt" desc nulls last, u."createdAt"
   limit 1;
  if r.id is null then
    if v_biz is not null then perform app.err(401, 'You no longer have access to this shop. Please sign in again.'); end if;
    perform app.err(401, 'Session expired. Please sign in again.');
  end if;
  return r;
end $$;

create or replace function app.need_owner(me app.ctx) returns void language plpgsql as $$
begin
  if me.role <> 'SELLER' or coalesce(me.staff_role, '') <> 'OWNER' then
    perform app.err(403, 'Only the shop owner can do this');
  end if;
end $$;

-- ---------- PIN and password now belong to the account (same for every shop) ----------
create or replace function app.pin_status(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('hasPin', "pinHash" is not null, 'mustChangePassword', "mustChangePassword") from "Account" where id = auth.uid()
$$;

create or replace function app.pin_set(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare a "Account";
begin
  perform app.check_pin_format(b->>'pin');
  select * into a from "Account" where id = auth.uid() for update;
  if not found then perform app.err(401, 'Session expired. Please sign in again.'); end if;
  if a."pinHash" is not null then
    if coalesce(b->>'currentPin', '') = '' or extensions.crypt(b->>'currentPin', a."pinHash") <> a."pinHash" then
      perform app.err(400, 'Current PIN is incorrect');
    end if;
  end if;
  update "Account" set "pinHash" = extensions.crypt(b->>'pin', extensions.gen_salt('bf', 10)), "pinFailedCount" = 0 where id = a.id;
  perform app.audit(me.business_id, me.id, 'User', me.id, case when a."pinHash" is null then 'PIN_CREATED' else 'PIN_CHANGED' end);
  return jsonb_build_object('hasPin', true);
end $$;

-- Not raised as an error on a wrong PIN, so the failure count is committed.
create or replace function app.pin_verify(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare a "Account"; left_tries int;
begin
  select * into a from "Account" where id = auth.uid() for update;
  if a."pinHash" is null then perform app.err(400, 'Create your PIN first'); end if;
  if coalesce(b->>'pin', '') ~ '^\d{6}$' and extensions.crypt(b->>'pin', a."pinHash") = a."pinHash" then
    update "Account" set "pinFailedCount" = 0 where id = a.id;
    return jsonb_build_object('ok', true);
  end if;
  left_tries := greatest(0, 5 - (a."pinFailedCount" + 1));
  if left_tries = 0 then
    update "Account" set "pinFailedCount" = 0 where id = a.id;
    perform app.audit(me.business_id, me.id, 'User', me.id, 'PIN_LOCKOUT');
    return jsonb_build_object('ok', false, 'signOut', true, 'attemptsLeft', 0);
  end if;
  update "Account" set "pinFailedCount" = "pinFailedCount" + 1 where id = a.id;
  return jsonb_build_object('ok', false, 'signOut', false, 'attemptsLeft', left_tries);
end $$;

-- Only right after a fresh password sign-in (Forgot PIN).
create or replace function app.pin_reset(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare signed_in bigint;
begin
  perform app.check_pin_format(b->>'pin');
  select max((e->>'timestamp')::bigint) into signed_in
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]')) e where e->>'method' = 'password';
  if signed_in is null or signed_in < extract(epoch from now())::bigint - 300 then
    perform app.err(403, 'Confirm your password to reset your PIN');
  end if;
  update "Account" set "pinHash" = extensions.crypt(b->>'pin', extensions.gen_salt('bf', 10)), "pinFailedCount" = 0 where id = auth.uid();
  perform app.audit(me.business_id, me.id, 'User', me.id, 'PIN_RESET');
  return jsonb_build_object('hasPin', true);
end $$;

create or replace function app.set_account_password(p_auth uuid, p_password text, p_must_change boolean) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text := extensions.crypt(p_password, extensions.gen_salt('bf', 10));
begin
  update auth.users set encrypted_password = v_hash, updated_at = now() where id = p_auth;
  update "User" set "passwordHash" = v_hash where "authUserId" = p_auth;
  update "Account" set "mustChangePassword" = p_must_change where id = p_auth;
end $$;

-- Kept for older callers: sets the password of the account behind an app user.
create or replace function app.set_password(p_user text, p_password text, p_must_change boolean) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  perform app.set_account_password((select "authUserId" from "User" where id = p_user), p_password, p_must_change);
end $$;

create or replace function app.change_password(me app.ctx, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_current text := coalesce(b->>'currentPassword', ''); v_new text := coalesce(b->>'newPassword', ''); v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if not coalesce(app.password_ok(v_current, v_hash), false) then perform app.err(400, 'Current password is incorrect'); end if;
  if length(v_new) < 8 then perform app.err(400, 'New password must be at least 8 characters'); end if;
  if v_new = v_current then perform app.err(400, 'Choose a password different from the current one'); end if;
  if v_new in ('123456789', '12345678', 'password', '11111111', '00000000') or v_new ~ '^(\d)\1+$' then
    perform app.err(400, 'That password is too easy to guess');
  end if;
  perform app.set_account_password(auth.uid(), v_new, false);
  perform app.audit(me.business_id, me.id, 'User', me.id, 'PASSWORD_CHANGED');
  return jsonb_build_object('changed', true);
end $$;

-- ---------- Adding people to a shop ----------
-- Links an existing OrderBook account by phone, or creates one with a temporary password.
create or replace function app.add_member(p_biz text, p_name text, p_phone text, p_role text, p_staff_role text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_auth uuid; v_hash text; v_pw text; v_user text;
begin
  if exists (select 1 from "User" where "businessId" = p_biz and phone = p_phone) then
    perform app.err(409, 'A user with this phone already exists');
  end if;
  select a.id, a.encrypted_password into v_auth, v_hash from auth.users a where a.email = app.phone_email(p_phone);
  if v_auth is null then
    v_pw := app.temp_password();
    v_hash := extensions.crypt(v_pw, extensions.gen_salt('bf', 10));
    v_auth := app.create_auth_user(p_phone, v_hash);
    insert into "Account" (id, phone, name, "mustChangePassword") values (v_auth, p_phone, p_name, true);
  else
    insert into "Account" (id, phone, name) values (v_auth, p_phone, p_name) on conflict (id) do nothing;
  end if;
  insert into "User" ("businessId", name, phone, "passwordHash", role, "staffRole", "authUserId")
  values (p_biz, p_name, p_phone, v_hash, p_role::"UserRole", p_staff_role, v_auth) returning id into v_user;
  return jsonb_build_object('userId', v_user, 'temporaryPassword', v_pw, 'existingAccount', v_pw is null);
end $$;

create or replace function app.check_new_person(b jsonb) returns text language plpgsql as $$
declare v_phone text := btrim(regexp_replace(coalesce(b->>'phone', ''), '\s+', '', 'g'));
begin
  if app.blank(b->>'name') then perform app.err(400, 'Name is required'); end if;
  if v_phone = '' then perform app.err(400, 'Phone is required'); end if;
  if length(coalesce(b->>'phone', '')) < 9 then perform app.err(400, 'Phone must be at least 9 characters'); end if;
  return v_phone;
end $$;

-- POST /customers
create or replace function app.create_customer(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare v_phone text; m jsonb; c "Customer";
begin
  perform app.need_role(me, 'SELLER');
  v_phone := app.check_new_person(b);
  m := app.add_member(me.business_id, b->>'name', v_phone, 'CUSTOMER', null);
  insert into "Customer" ("businessId", "userId", name, phone, "creditAllowed", notes)
  values (me.business_id, m->>'userId', b->>'name', v_phone, coalesce(app.bool(b->'creditAllowed'), true), b->>'notes') returning * into c;
  perform app.audit(me.business_id, me.id, 'Customer', c.id, 'CREATE', jsonb_build_object('name', c.name, 'phone', v_phone));
  return to_jsonb(c) || jsonb_build_object('temporaryPassword', m->'temporaryPassword', 'existingAccount', m->'existingAccount');
end $$;

-- A shop may only reset a password the person uses with that shop alone.
create or replace function app.reset_member_password(me app.ctx, p_user text) returns jsonb language plpgsql as $$
declare v_auth uuid; v_phone text; v_pw text := app.temp_password();
begin
  select "authUserId", phone into v_auth, v_phone from "User" where id = p_user and "businessId" = me.business_id;
  if v_auth is null then perform app.err(404, 'User not found'); end if;
  if exists (select 1 from "User" where "authUserId" = v_auth and "businessId" <> me.business_id) then
    perform app.err(409, 'This person also uses OrderBook with another shop, so only they can change their password.');
  end if;
  perform app.set_account_password(v_auth, v_pw, true);
  update "Account" set "pinFailedCount" = 0 where id = v_auth;
  return jsonb_build_object('phone', v_phone, 'temporaryPassword', v_pw);
end $$;

-- POST /customers/:id/reset-password
create or replace function app.reset_customer_password(me app.ctx, p_id text) returns jsonb language plpgsql as $$
declare c "Customer"; r jsonb;
begin
  perform app.need_role(me, 'SELLER');
  select * into c from "Customer" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  r := app.reset_member_password(me, c."userId");
  perform app.audit(me.business_id, me.id, 'Customer', c.id, 'PASSWORD_RESET');
  return r;
end $$;

-- ---------- Staff (owner only) ----------
create or replace function app.list_staff(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_owner(me);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'phone', u.phone, 'staffRole', u."staffRole",
      'isActive', u."isActive", 'isMe', u.id = me.id, 'createdAt', u."createdAt") order by u."staffRole", u.name), '[]')
    from "User" u where u."businessId" = me.business_id and u.role = 'SELLER');
end $$;

create or replace function app.add_staff(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare v_phone text; m jsonb;
begin
  perform app.need_owner(me);
  v_phone := app.check_new_person(b);
  m := app.add_member(me.business_id, b->>'name', v_phone, 'SELLER', 'STAFF');
  perform app.audit(me.business_id, me.id, 'User', m->>'userId', 'STAFF_ADDED', jsonb_build_object('name', b->>'name', 'phone', v_phone));
  return jsonb_build_object('id', m->>'userId', 'name', b->>'name', 'phone', v_phone,
    'temporaryPassword', m->'temporaryPassword', 'existingAccount', m->'existingAccount');
end $$;

create or replace function app.staff_action(me app.ctx, p_id text, p_action text) returns jsonb language plpgsql as $$
declare u "User"; r jsonb;
begin
  perform app.need_owner(me);
  select * into u from "User" where id = p_id and "businessId" = me.business_id and role = 'SELLER';
  if not found then perform app.err(404, 'Staff member not found'); end if;
  if u."staffRole" = 'OWNER' then perform app.err(400, 'The owner cannot be changed here'); end if;
  if p_action = 'reset-password' then
    r := app.reset_member_password(me, u.id);
  else
    update "User" set "isActive" = (p_action = 'activate') where id = u.id;
    r := jsonb_build_object('id', u.id, 'isActive', p_action = 'activate');
  end if;
  perform app.audit(me.business_id, me.id, 'User', u.id, 'STAFF_' || upper(replace(p_action, '-', '_')));
  return r;
end $$;

-- ---------- Shops on this account ----------
-- GET /auth/businesses
create or replace function app.my_businesses(me app.ctx) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('businessId', bz.id, 'businessName', bz.name, 'role', u.role, 'staffRole', u."staffRole",
      'current', bz.id = me.business_id) order by bz.id <> me.business_id, u."lastUsedAt" desc nulls last, bz.name), '[]')
    from "User" u join "Business" bz on bz.id = u."businessId"
   where u."authUserId" = auth.uid() and u."isActive"
$$;

-- POST /auth/switch (sent with the target shop in x-business-id)
create or replace function app.switch_business(me app.ctx) returns jsonb language plpgsql as $$
begin
  update "User" set "lastUsedAt" = now() at time zone 'utc' where id = me.id;
  return app.auth_me(me);
end $$;

-- POST /businesses { name, phone? } — an owner opens another shop on the same account.
create or replace function app.create_business(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare bz "Business"; u "User";
begin
  perform app.need_owner(me);
  if app.blank(b->>'name') then perform app.err(400, 'Shop name is required'); end if;
  if (select count(*) from "User" where "authUserId" = auth.uid() and "staffRole" = 'OWNER') >= 10 then
    perform app.err(400, 'You can own up to 10 shops');
  end if;
  insert into "Business" (name, phone) values (btrim(b->>'name'), nullif(btrim(coalesce(b->>'phone', '')), '')) returning * into bz;
  insert into "BusinessSettings" ("businessId") values (bz.id);
  select * into u from "User" where id = me.id;
  insert into "User" ("businessId", name, phone, "passwordHash", role, "staffRole", "authUserId", "lastUsedAt")
  values (bz.id, u.name, u.phone, u."passwordHash", 'SELLER', 'OWNER', u."authUserId", now() at time zone 'utc');
  perform app.audit(bz.id, me.id, 'Business', bz.id, 'CREATE', jsonb_build_object('name', bz.name, 'fromBusinessId', me.business_id));
  return jsonb_build_object('businessId', bz.id, 'businessName', bz.name);
end $$;

-- ---------- Auth payloads ----------
create or replace function app.auth_me(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('id', me.id, 'name', me.name, 'phone', me.phone, 'role', me.role, 'businessId', me.business_id,
    'customerId', me.customer_id, 'staffRole', me.staff_role,
    'businessName', (select name from "Business" where id = me.business_id),
    'businessCount', (select count(*) from "User" where "authUserId" = auth.uid() and "isActive"),
    'business', (select jsonb_build_object('id', bz.id, 'name', bz.name, 'settings',
        (select app.fix(to_jsonb(s), array['approvalToleranceAbs','approvalTolerancePct','defaultDeliveryCharge'])
           from "BusinessSettings" s where s."businessId" = bz.id)) from "Business" bz where bz.id = me.business_id),
    'creditAllowed', (select c."creditAllowed" from "Customer" c where c.id = me.customer_id))
$$;

create or replace function app.auth_login(me app.ctx) returns jsonb language plpgsql as $$
begin
  update "User" set "lastUsedAt" = now() at time zone 'utc' where id = me.id;
  perform app.audit(me.business_id, me.id, 'User', me.id, 'LOGIN');
  return jsonb_build_object('user', jsonb_build_object('id', me.id, 'name', me.name, 'phone', me.phone, 'role', me.role,
    'businessId', me.business_id, 'customerId', me.customer_id, 'staffRole', me.staff_role,
    'businessName', (select name from "Business" where id = me.business_id),
    'businessCount', (select count(*) from "User" where "authUserId" = auth.uid() and "isActive")));
end $$;


-- ---------- Router: the only entry point the browser can call ----------
create or replace function public.api(p_method text, p_path text, p_query jsonb default '{}', p_body jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  me app.ctx := app.me();
  m text := upper(p_method);
  s text[] := string_to_array(btrim(split_part(p_path, '?', 1), '/'), '/');
  n int; q jsonb := coalesce(p_query, '{}'); b jsonb := coalesce(p_body, '{}');
begin
  n := coalesce(array_length(s, 1), 0);
  if jsonb_typeof(b) <> 'object' then b := '{}'; end if;

  -- Temporary or default passwords must be changed before anything else.
  if exists (select 1 from "Account" where id = auth.uid() and "mustChangePassword")
     and not (s[1] = 'auth' and (s[2] in ('me', 'login', 'change-password') or (m = 'GET' and s[2] = 'pin' and n = 2))) then
    perform app.err(403, 'Change your temporary password to continue');
  end if;

  case s[1]
  when 'auth' then
    if m = 'GET' and s[2] = 'me' and n = 2 then return app.auth_me(me); end if;
    if m = 'POST' and s[2] = 'login' and n = 2 then return app.auth_login(me); end if;
    if m = 'GET' and s[2] = 'pin' and n = 2 then return app.pin_status(me); end if;
    if m = 'POST' and s[2] = 'pin' and s[3] = 'set' and n = 3 then return app.pin_set(me, b); end if;
    if m = 'POST' and s[2] = 'pin' and s[3] = 'verify' and n = 3 then return app.pin_verify(me, b); end if;
    if m = 'POST' and s[2] = 'pin' and s[3] = 'reset' and n = 3 then return app.pin_reset(me, b); end if;
    if m = 'POST' and s[2] = 'change-password' and n = 2 then return app.change_password(me, b); end if;
    if m = 'GET' and s[2] = 'businesses' and n = 2 then return app.my_businesses(me); end if;
    if m = 'POST' and s[2] = 'switch' and n = 2 then return app.switch_business(me); end if;

  when 'businesses' then
    if m = 'POST' and n = 1 then return app.create_business(me, b); end if;

  when 'staff' then
    if m = 'GET' and n = 1 then return app.list_staff(me); end if;
    if m = 'POST' and n = 1 then return app.add_staff(me, b); end if;
    if m = 'POST' and n = 3 and s[3] in ('activate', 'deactivate', 'reset-password') then return app.staff_action(me, s[2], s[3]); end if;

  when 'customers' then
    if s[2] = 'me' and s[3] = 'preferences' and n = 3 then
      if m = 'GET' then return app.preferences(me, b, false); end if;
      if m = 'PATCH' then return app.preferences(me, b, true); end if;
    end if;
    if m = 'GET' and n = 1 then return app.list_customers(me); end if;
    if m = 'POST' and n = 1 then return app.create_customer(me, b); end if;
    if m = 'GET' and s[2] = 'outstanding' and s[3] = 'aging' and n = 3 then return app.aging(me); end if;
    if m = 'POST' and n = 3 and s[3] = 'reset-password' then return app.reset_customer_password(me, s[2]); end if;
    if m = 'GET' and n = 2 then return app.get_customer(me, s[2]); end if;
    if m = 'PATCH' and n = 2 then return app.update_customer(me, s[2], b); end if;

  when 'drafts' then
    if m = 'GET' and n = 1 then return app.list_drafts(me); end if;
    if m = 'PUT' and n = 2 then return app.save_draft(me, s[2], b); end if;
    if m = 'DELETE' and n = 2 then return app.delete_draft(me, s[2]); end if;

  when 'notifications' then
    if m = 'GET' and s[2] = 'me' and n = 2 then return app.my_notifications(me); end if;

  when 'orders' then
    if m = 'GET' and s[2] = 'dashboard' and n = 3 then
      if s[3] = 'seller' then return app.seller_dashboard(me); end if;
      if s[3] = 'customer' then return app.customer_dashboard(me); end if;
    end if;
    if m = 'GET' and n = 1 then return app.list_orders(me, q); end if;
    if m = 'POST' and n = 1 then return app.create_order(me, b); end if;
    if m = 'GET' and n = 2 then return app.get_order(me, s[2]); end if;
    if m = 'POST' and n = 4 and s[3] = 'prepare' and s[4] = 'start' then return app.start_preparing(me, s[2]); end if;
    if m = 'POST' and n = 3 then
      case s[3]
        when 'prepare' then return app.save_preparation(me, s[2], b);
        when 'respond' then return app.customer_respond(me, s[2], b);
        when 'flag-price' then return app.flag_price(me, s[2], b);
        when 'agree-phone' then return app.agree_phone(me, s[2], b);
        when 'ready' then return app.mark_ready(me, s[2]);
        when 'dispatch' then return app.dispatch_order(me, s[2], b);
        when 'deliver' then return app.deliver_order(me, s[2], b);
        when 'cancel' then return app.cancel_order(me, s[2], b);
        else null;
      end case;
    end if;

  when 'payments' then
    if m = 'GET' and n = 1 then return app.list_payments(me); end if;
    if m = 'GET' and n = 2 and s[2] = 'attempts' then return app.list_attempts(me, q); end if;
    if m = 'GET' and n = 3 and s[2] = 'order' then return app.payment_page(me, s[3]); end if;
    if m = 'GET' and n = 3 and s[2] = 'receipts' then return app.get_receipt(me, s[3]); end if;
    if m = 'GET' and n = 3 and s[2] = 'history' and s[3] = 'me' then return app.payment_history(me); end if;
    if m = 'POST' and n = 2 and s[2] = 'initiate' then return app.initiate_payment(me, b); end if;
    if m = 'POST' and n = 2 and s[2] = 'checkout' then return app.checkout(me, b); end if;

  when 'products' then
    if m = 'GET' and n = 1 then return app.list_products(me, q); end if;
    if m = 'POST' and n = 1 then return app.create_product(me, b); end if;
    if m = 'GET' and n = 3 and s[2] = 'meta' and s[3] = 'categories' then return app.categories(me); end if;
    if m = 'GET' and n = 3 and s[2] = 'meta' and s[3] = 'highlights' then return app.highlights(me); end if;
    if m = 'PATCH' and n = 2 then return app.update_product(me, s[2], b); end if;
    if m = 'POST' and n = 3 and s[3] = 'archive' then return app.archive_product(me, s[2]); end if;
    if m = 'POST' and n = 3 and s[3] = 'variants' then return app.upsert_variant(me, s[2], b); end if;
    if m = 'POST' and n = 3 and s[3] = 'favourite' then return app.toggle_favourite(me, s[2]); end if;

  when 'reports' then
    if m = 'GET' and n = 1 then return app.reports(me); end if;
    if n = 2 and s[2] = 'settings' then
      if m = 'GET' then return app.settings(me, b, false); end if;
      if m = 'PATCH' then perform app.need_owner(me); return app.settings(me, b, true); end if;
    end if;
  else null;
  end case;

  perform app.err(404, 'Not found');
  return null;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
