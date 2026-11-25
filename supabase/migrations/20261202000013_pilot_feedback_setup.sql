-- OrderBook — Phase 7 (pilot): in-app feedback and a new-shop setup checklist.
--  * Anyone signed in can send feedback (rate-limited). OrderBook admins read it and mark it done.
--  * GET /setup tells a shop owner which first steps are still open.

create table if not exists "Feedback" (
  id text primary key default gen_random_uuid()::text,
  "businessId" text references "Business"(id) on delete set null,
  "accountId" uuid,
  role text,
  name text,
  phone text,
  message text not null,
  page text,
  status text not null default 'OPEN' check (status in ('OPEN', 'DONE')),
  "createdAt" timestamptz not null default now()
);
create index if not exists "Feedback_status_idx" on "Feedback" (status, "createdAt" desc);
alter table "Feedback" enable row level security;
revoke all on "Feedback" from anon, authenticated;

-- POST /feedback { message, page }
create or replace function app.send_feedback(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare v_msg text := btrim(coalesce(b->>'message', ''));
begin
  if length(v_msg) < 3 then perform app.err(400, 'Please write a little more'); end if;
  if length(v_msg) > 2000 then perform app.err(400, 'Please keep feedback under 2000 characters'); end if;
  if (select count(*) from "Feedback" where "accountId" = auth.uid() and "createdAt" > now() - interval '1 hour') >= 10 then
    perform app.err(429, 'Thanks! You have sent a lot of feedback recently. Please try again later.');
  end if;
  insert into "Feedback" ("businessId", "accountId", role, name, phone, message, page)
  values (me.business_id, auth.uid(), case when me.role = 'SELLER' then coalesce(me.staff_role, 'SELLER') else me.role end,
          me.name, me.phone, v_msg, left(b->>'page', 200));
  return jsonb_build_object('sent', true);
end $$;

-- GET /admin/feedback?status=OPEN|DONE|ALL
create or replace function app.admin_feedback(q jsonb) returns jsonb language plpgsql stable as $$
declare v_status text := upper(coalesce(nullif(q->>'status', ''), 'OPEN'));
begin
  perform app.need_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'message', f.message, 'page', f.page, 'status', f.status,
      'createdAt', f."createdAt", 'role', f.role, 'name', f.name, 'phone', f.phone,
      'shop', (select name from "Business" where id = f."businessId")) order by f."createdAt" desc), '[]')
    from (select * from "Feedback" where v_status = 'ALL' or status = v_status order by "createdAt" desc limit 300) f);
end $$;

-- POST /admin/feedback/:id/done  ·  /reopen
create or replace function app.admin_feedback_set(p_id text, p_status text) returns jsonb language plpgsql as $$
begin
  perform app.need_admin();
  update "Feedback" set status = p_status where id = p_id;
  if not found then perform app.err(404, 'Feedback not found'); end if;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- GET /setup — first steps for a new shop (any seller; online payments only matter to the owner).
create or replace function app.setup_status(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'SELLER');
  return jsonb_build_object(
    'products', exists (select 1 from "Product" where "businessId" = me.business_id),
    'customers', exists (select 1 from "Customer" where "businessId" = me.business_id),
    'orders', exists (select 1 from "Order" where "businessId" = me.business_id),
    'onlinePayments', exists (select 1 from "PayoutAccount" where "businessId" = me.business_id),
    'isOwner', coalesce(me.staff_role, '') = 'OWNER');
end $$;

-- ---------- Router ----------
do $$
declare src text;
begin
  select replace(pg_get_functiondef('public.api(text, text, jsonb, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  if position('app.send_feedback' in src) = 0 then
    src := replace(src,
      $r$  when 'admin' then
$r$,
      $r$  when 'feedback' then
    if m = 'POST' and n = 1 then return app.send_feedback(me, b); end if;

  when 'setup' then
    if m = 'GET' and n = 1 then return app.setup_status(me); end if;

  when 'admin' then
    if m = 'GET' and n = 2 and s[2] = 'feedback' then return app.admin_feedback(q); end if;
    if m = 'POST' and n = 4 and s[2] = 'feedback' and s[4] = 'done' then return app.admin_feedback_set(s[3], 'DONE'); end if;
    if m = 'POST' and n = 4 and s[2] = 'feedback' and s[4] = 'reopen' then return app.admin_feedback_set(s[3], 'OPEN'); end if;
$r$);
    if position('app.send_feedback' in src) = 0 then raise exception 'router patch failed'; end if;
    execute src;
  end if;
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
