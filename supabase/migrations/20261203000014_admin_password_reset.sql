-- OrderBook — admin password reset.
-- POST /admin/reset-password { phone } sets any account's password to 123456789. The person must choose a
-- new password at their next sign-in (mustChangePassword), and their PIN lockout counter is cleared.
-- Shop owners' own customer/staff resets keep using random temporary passwords.

create or replace function app.admin_reset_password(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare v_phone text := regexp_replace(coalesce(b->>'phone', ''), '\s+', '', 'g'); a "Account";
begin
  perform app.need_admin();
  if v_phone !~ '^\+?\d{9,15}$' then perform app.err(400, 'Enter a valid phone number'); end if;
  select * into a from "Account" where phone = v_phone;
  if not found then perform app.err(404, 'No OrderBook account uses this phone number'); end if;
  if a.id = auth.uid() then perform app.err(400, 'Use Change password for your own account'); end if;
  perform app.set_account_password(a.id, '123456789', true);
  update "Account" set "pinFailedCount" = 0 where id = a.id;
  perform app.audit((select "businessId" from "User" where "authUserId" = a.id order by "createdAt" limit 1),
    me.id, 'Account', a.id::text, 'ADMIN_PASSWORD_RESET', jsonb_build_object('by', auth.uid()));
  return jsonb_build_object('phone', a.phone, 'name', a.name, 'temporaryPassword', '123456789',
    'shops', (select coalesce(jsonb_agg(distinct bz.name), '[]') from "User" u join "Business" bz on bz.id = u."businessId"
               where u."authUserId" = a.id));
end $$;

do $$
declare src text;
begin
  select replace(pg_get_functiondef('public.api(text, text, jsonb, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  if position('app.admin_reset_password' in src) = 0 then
    src := replace(src,
      $r$  when 'admin' then
$r$,
      $r$  when 'admin' then
    if m = 'POST' and n = 2 and s[2] = 'reset-password' then return app.admin_reset_password(me, b); end if;
$r$);
    if position('app.admin_reset_password' in src) = 0 then raise exception 'router patch failed'; end if;
    execute src;
  end if;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
