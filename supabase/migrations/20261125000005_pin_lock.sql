-- OrderBook — required 6-digit app-lock PIN (hashed with bcrypt, 5 wrong tries ends the session).
alter table "User" add column if not exists "pinHash" text;
alter table "User" add column if not exists "pinFailedCount" int not null default 0;

create or replace function app.check_pin_format(p text) returns void language plpgsql as $$
begin
  if p is null or p !~ '^\d{6}$' then perform app.err(400, 'PIN must be exactly 6 digits'); end if;
end $$;

-- GET /auth/pin
create or replace function app.pin_status(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('hasPin', "pinHash" is not null) from "User" where id = me.id
$$;

-- POST /auth/pin/set  { pin, currentPin? }
create or replace function app.pin_set(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare u "User";
begin
  perform app.check_pin_format(b->>'pin');
  select * into u from "User" where id = me.id for update;
  if u."pinHash" is not null then
    if coalesce(b->>'currentPin', '') = '' or extensions.crypt(b->>'currentPin', u."pinHash") <> u."pinHash" then
      perform app.err(400, 'Current PIN is incorrect');
    end if;
  end if;
  update "User" set "pinHash" = extensions.crypt(b->>'pin', extensions.gen_salt('bf', 10)), "pinFailedCount" = 0 where id = me.id;
  perform app.audit(me.business_id, me.id, 'User', me.id, case when u."pinHash" is null then 'PIN_CREATED' else 'PIN_CHANGED' end);
  return jsonb_build_object('hasPin', true);
end $$;

-- POST /auth/pin/verify  { pin }
-- Not raised as an error on a wrong PIN, so the failure count is committed.
create or replace function app.pin_verify(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare u "User"; left_tries int;
begin
  select * into u from "User" where id = me.id for update;
  if u."pinHash" is null then perform app.err(400, 'Create your PIN first'); end if;
  if coalesce(b->>'pin', '') ~ '^\d{6}$' and extensions.crypt(b->>'pin', u."pinHash") = u."pinHash" then
    update "User" set "pinFailedCount" = 0 where id = me.id;
    return jsonb_build_object('ok', true);
  end if;
  left_tries := greatest(0, 5 - (u."pinFailedCount" + 1));
  if left_tries = 0 then
    update "User" set "pinFailedCount" = 0 where id = me.id;
    perform app.audit(me.business_id, me.id, 'User', me.id, 'PIN_LOCKOUT');
    return jsonb_build_object('ok', false, 'signOut', true, 'attemptsLeft', 0);
  end if;
  update "User" set "pinFailedCount" = "pinFailedCount" + 1 where id = me.id;
  return jsonb_build_object('ok', false, 'signOut', false, 'attemptsLeft', left_tries);
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;

-- POST /auth/pin/reset  { pin } — only right after a fresh password sign-in (Forgot PIN).
create or replace function app.pin_reset(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare signed_in bigint;
begin
  perform app.check_pin_format(b->>'pin');
  select max((e->>'timestamp')::bigint) into signed_in
    from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]')) e where e->>'method' = 'password';
  if signed_in is null or signed_in < extract(epoch from now())::bigint - 300 then
    perform app.err(403, 'Confirm your password to reset your PIN');
  end if;
  update "User" set "pinHash" = extensions.crypt(b->>'pin', extensions.gen_salt('bf', 10)), "pinFailedCount" = 0 where id = me.id;
  perform app.audit(me.business_id, me.id, 'User', me.id, 'PIN_RESET');
  return jsonb_build_object('hasPin', true);
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
