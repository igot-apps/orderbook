-- OrderBook — allow simple passwords such as 123456789 when changing a password (owner's request).
-- Still required: the correct current password, at least 8 characters, and a password different from the current one.
create or replace function app.change_password(me app.ctx, b jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_current text := coalesce(b->>'currentPassword', ''); v_new text := coalesce(b->>'newPassword', ''); v_hash text;
begin
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  if not coalesce(app.password_ok(v_current, v_hash), false) then perform app.err(400, 'Current password is incorrect'); end if;
  if length(v_new) < 8 then perform app.err(400, 'New password must be at least 8 characters'); end if;
  if v_new = v_current then perform app.err(400, 'Choose a password different from the current one'); end if;
  perform app.set_account_password(auth.uid(), v_new, false);
  perform app.audit(me.business_id, me.id, 'User', me.id, 'PASSWORD_CHANGED');
  return jsonb_build_object('changed', true);
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
