-- OrderBook — Phase 3 (no SMS): anyone can open an account and a shop from the sign-in screen.
--  * Phone numbers typed in by the person themselves are NOT verified, so other shops can't link them
--    (stops someone claiming another person's number and then being added to that person's shops).
--  * Sign-ups are rate-limited.

alter table "Account" add column if not exists "phoneVerified" boolean not null default true;

create table if not exists "SignupLog" (
  id bigint generated always as identity primary key,
  "createdAt" timestamptz not null default now()
);
alter table "SignupLog" enable row level security;
revoke all on "SignupLog" from anon, authenticated;
revoke all on sequence "SignupLog_id_seq" from anon, authenticated;

-- Same as Phase 2, but refuses to link a self-registered (unverified) number.
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
    if exists (select 1 from "Account" where id = v_auth and not "phoneVerified") then
      perform app.err(409, 'This number was registered online and has not been verified, so it can''t be added to your shop yet.');
    end if;
    insert into "Account" (id, phone, name) values (v_auth, p_phone, p_name) on conflict (id) do nothing;
  end if;
  insert into "User" ("businessId", name, phone, "passwordHash", role, "staffRole", "authUserId")
  values (p_biz, p_name, p_phone, v_hash, p_role::"UserRole", p_staff_role, v_auth) returning id into v_user;
  return jsonb_build_object('userId', v_user, 'temporaryPassword', v_pw, 'existingAccount', v_pw is null);
end $$;

-- POST via supabase.rpc('signup', ...) — the only function signed-out visitors may call.
create or replace function public.signup(p_name text, p_phone text, p_password text, p_shop text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_shop text := btrim(coalesce(p_shop, ''));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g');
  v_pw text := coalesce(p_password, '');
  v_hash text; v_auth uuid; bz "Business"; v_user text;
begin
  if v_name = '' or length(v_name) > 80 then perform app.err(400, 'Enter your name (up to 80 characters)'); end if;
  if v_shop = '' or length(v_shop) > 80 then perform app.err(400, 'Enter your shop name (up to 80 characters)'); end if;
  if v_phone !~ '^\+?\d{9,15}$' then perform app.err(400, 'Enter a valid phone number'); end if;
  if length(v_pw) < 8 or length(v_pw) > 72 then perform app.err(400, 'Password must be 8 to 72 characters'); end if;
  if v_pw in ('123456789', '12345678', 'password', '11111111', '00000000') or v_pw ~ '^(\d)\1+$' then
    perform app.err(400, 'That password is too easy to guess');
  end if;

  -- At most 20 new shops per hour across the whole service.
  perform pg_advisory_xact_lock(hashtext('orderbook-signup'));
  if (select count(*) from "SignupLog" where "createdAt" > now() - interval '1 hour') >= 20 then
    perform app.err(429, 'Too many sign-ups right now. Please try again in a while.');
  end if;
  insert into "SignupLog" default values;

  v_hash := extensions.crypt(v_pw, extensions.gen_salt('bf', 10));
  v_auth := app.create_auth_user(v_phone, v_hash);   -- 409 if the number is already registered
  insert into "Account" (id, phone, name, "phoneVerified") values (v_auth, v_phone, v_name, false);
  insert into "Business" (name, phone) values (v_shop, v_phone) returning * into bz;
  insert into "BusinessSettings" ("businessId") values (bz.id);
  insert into "User" ("businessId", name, phone, "passwordHash", role, "staffRole", "authUserId", "lastUsedAt")
  values (bz.id, v_name, v_phone, v_hash, 'SELLER', 'OWNER', v_auth, now() at time zone 'utc') returning id into v_user;
  perform app.audit(bz.id, v_user, 'Business', bz.id, 'SIGNUP', jsonb_build_object('name', v_shop));
  return jsonb_build_object('ok', true, 'businessName', bz.name);
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.signup(text, text, text, text) from public;
grant execute on function public.signup(text, text, text, text) to anon, authenticated;
