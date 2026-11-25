-- OrderBook — Phase 1 security:
--  * order numbers from a locked per-shop counter (no duplicates under concurrent orders)
--  * no shared default password: new customers get a random temporary password
--  * anyone on a temporary/default password must change it before using the app

-- ---------- Per-shop order number counter ----------
create table if not exists "OrderCounter" (
  "businessId" text primary key references "Business"(id) on delete cascade,
  "lastNumber" int not null
);
alter table "OrderCounter" enable row level security;
revoke all on "OrderCounter" from anon, authenticated;

-- Start each shop's counter after its highest existing OP-number.
insert into "OrderCounter" ("businessId", "lastNumber")
select b.id, coalesce((select max(substring(o."orderNumber" from '^OP-(\d+)$')::int) from "Order" o where o."businessId" = b.id), 0)
  from "Business" b
on conflict ("businessId") do nothing;

-- The row lock taken by the upsert makes concurrent callers wait their turn.
create or replace function app.next_order_number(p_biz text) returns text language plpgsql as $$
declare n int;
begin
  insert into "OrderCounter" ("businessId", "lastNumber")
  values (p_biz, coalesce((select max(substring("orderNumber" from '^OP-(\d+)$')::int) from "Order" where "businessId" = p_biz), 0) + 1)
  on conflict ("businessId") do update set "lastNumber" = "OrderCounter"."lastNumber" + 1
  returning "lastNumber" into n;
  return 'OP-' || lpad(n::text, 5, '0');
end $$;

-- ---------- Passwords ----------
-- bcrypt check that also accepts $2b$ hashes written by the old Node backend (pgcrypto only reads $2a$).
create or replace function app.password_ok(p_password text, p_hash text) returns boolean language sql immutable as $$
  select p_hash is not null and p_password is not null
     and extensions.crypt(p_password, regexp_replace(p_hash, '^\$2[by]\$', '$2a$')) = regexp_replace(p_hash, '^\$2[by]\$', '$2a$')
$$;

alter table "User" add column if not exists "mustChangePassword" boolean not null default false;

-- 8 characters without look-alikes (no 0/O, 1/I/L).
create or replace function app.temp_password() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (get_byte(r.b, i) % 31) + 1, 1), '' order by i)
    from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) i
$$;

-- Sets the password for both the app user and its Supabase login.
create or replace function app.set_password(p_user text, p_password text, p_must_change boolean) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_hash text := extensions.crypt(p_password, extensions.gen_salt('bf', 10)); v_auth uuid;
begin
  update "User" set "passwordHash" = v_hash, "mustChangePassword" = p_must_change where id = p_user returning "authUserId" into v_auth;
  if v_auth is not null then
    update auth.users set encrypted_password = v_hash, updated_at = now() where id = v_auth;
  end if;
end $$;

-- POST /auth/change-password { currentPassword, newPassword }
create or replace function app.change_password(me app.ctx, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_current text := coalesce(b->>'currentPassword', ''); v_new text := coalesce(b->>'newPassword', ''); v_hash text;
begin
  select a.encrypted_password into v_hash from "User" u join auth.users a on a.id = u."authUserId" where u.id = me.id;
  if not coalesce(app.password_ok(v_current, v_hash), false) then perform app.err(400, 'Current password is incorrect'); end if;
  if length(v_new) < 8 then perform app.err(400, 'New password must be at least 8 characters'); end if;
  if v_new = v_current then perform app.err(400, 'Choose a password different from the current one'); end if;
  if v_new in ('123456789', '12345678', 'password', '11111111', '00000000') or v_new ~ '^(\d)\1+$' then
    perform app.err(400, 'That password is too easy to guess');
  end if;
  perform app.set_password(me.id, v_new, false);
  perform app.audit(me.business_id, me.id, 'User', me.id, 'PASSWORD_CHANGED');
  return jsonb_build_object('changed', true);
end $$;

-- POST /customers/:id/reset-password (seller) → new temporary password, shown once.
create or replace function app.reset_customer_password(me app.ctx, p_id text) returns jsonb language plpgsql as $$
declare c "Customer"; v_pw text := app.temp_password();
begin
  perform app.need_role(me, 'SELLER');
  select * into c from "Customer" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  perform app.set_password(c."userId", v_pw, true);
  update "User" set "pinFailedCount" = 0 where id = c."userId";
  perform app.audit(me.business_id, me.id, 'Customer', c.id, 'PASSWORD_RESET');
  return jsonb_build_object('phone', c.phone, 'temporaryPassword', v_pw);
end $$;

-- POST /customers: same as before, but with a random temporary password instead of a shared default.
create or replace function app.create_customer(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare v_phone text := btrim(regexp_replace(coalesce(b->>'phone', ''), '\s+', '', 'g')); u "User"; c "Customer"; v_pw text := app.temp_password(); v_hash text;
begin
  perform app.need_role(me, 'SELLER');
  if app.blank(b->>'name') then perform app.err(400, 'Name is required'); end if;
  if v_phone = '' then perform app.err(400, 'Phone is required'); end if;
  if length(coalesce(b->>'phone', '')) < 9 then perform app.err(400, 'Phone must be at least 9 characters'); end if;
  if exists (select 1 from "User" where "businessId" = me.business_id and phone = v_phone) then
    perform app.err(409, 'A user with this phone already exists');
  end if;
  v_hash := extensions.crypt(v_pw, extensions.gen_salt('bf', 10));
  insert into "User" ("businessId", name, phone, "passwordHash", role, "mustChangePassword")
  values (me.business_id, b->>'name', v_phone, v_hash, 'CUSTOMER', true) returning * into u;
  update "User" set "authUserId" = app.create_auth_user(v_phone, v_hash) where id = u.id;
  insert into "Customer" ("businessId", "userId", name, phone, "creditAllowed", notes)
  values (me.business_id, u.id, b->>'name', v_phone, coalesce(app.bool(b->'creditAllowed'), true), b->>'notes') returning * into c;
  perform app.audit(me.business_id, me.id, 'Customer', c.id, 'CREATE', jsonb_build_object('name', c.name, 'phone', v_phone));
  return to_jsonb(c) || jsonb_build_object('temporaryPassword', v_pw);
end $$;

-- GET /auth/pin now also reports whether a password change is required.
create or replace function app.pin_status(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('hasPin', "pinHash" is not null, 'mustChangePassword', "mustChangePassword") from "User" where id = me.id
$$;

-- Anyone still on the old shared default password must change it.
update "User" u set "mustChangePassword" = true
  from auth.users a
 where a.id = u."authUserId" and app.password_ok('123456789', a.encrypted_password);

revoke execute on all functions in schema app from public, anon, authenticated;
