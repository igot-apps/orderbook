-- OrderBook on Supabase — part 4: products, customers, reports, notifications, auth,
-- the public.api router, security lockdown and migration of existing logins.

-- ---------- Products ----------
create or replace function app.list_products(me app.ctx, q jsonb) returns jsonb language plpgsql stable as $$
declare
  v_q text := nullif(q->>'q', ''); v_cat text := nullif(q->>'category', '');
  v_visible boolean := me.role = 'CUSTOMER' or q->>'visibleOnly' = 'true';
  v_arch boolean := me.role = 'SELLER' and q->>'includeArchived' = 'true';
begin
  return (select coalesce(jsonb_agg(app.j_product(p, me.customer_id) order by p."usageCount" desc, p.name), '[]')
    from "Product" p
   where p."businessId" = me.business_id
     and (v_arch or not p."isArchived")
     and (not v_visible or p."isVisible")
     and (v_cat is null or p.category = v_cat)
     and (v_q is null or p.name ilike '%' || v_q || '%' or p.category ilike '%' || v_q || '%' or p.description ilike '%' || v_q || '%'
          or exists (select 1 from "ProductVariant" v where v."productId" = p.id
                       and (v.name ilike '%' || v_q || '%' or v.brand ilike '%' || v_q || '%'))));
end $$;

create or replace function app.categories(me app.ctx) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(category order by category), '[]') from (
    select distinct category from "Product" where "businessId" = me.business_id and not "isArchived" and "isVisible") s
$$;

create or replace function app.highlights(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'mostUsed', (select coalesce(jsonb_agg(app.j_product(p, null) - 'isFavourite' order by p."usageCount" desc), '[]') from (
       select * from "Product" where "businessId" = me.business_id and not "isArchived" and "isVisible" and "usageCount" > 0
       order by "usageCount" desc limit 8) p),
    'recent', (select coalesce(jsonb_agg(app.j_product(p, null) - 'isFavourite' order by p."lastUsedAt" desc), '[]') from (
       select * from "Product" where "businessId" = me.business_id and not "isArchived" and "isVisible" and "lastUsedAt" is not null
       order by "lastUsedAt" desc limit 8) p),
    'favourites', (select coalesce(jsonb_agg(app.j_product(p, null) - 'isFavourite'), '[]') from (
       select p.* from "CustomerFavourite" f join "Product" p on p.id = f."productId"
        where f."customerId" = me.customer_id and not p."isArchived" and p."isVisible" limit 12) p))
$$;

create or replace function app.check_variant(v jsonb) returns void language plpgsql as $$
begin
  if app.blank(v->>'name') then perform app.err(400, 'Variant name required'); end if;
  if coalesce(v->>'unit', '') not in (select unnest(enum_range(null::"SellingUnit"))::text) then perform app.err(400, 'Invalid unit'); end if;
  if coalesce(v->>'pricingType', '') not in (select unnest(enum_range(null::"PricingType"))::text) then perform app.err(400, 'Invalid pricing type'); end if;
  if app.num(v->'unitPrice') is null then perform app.err(400, 'Unit price required'); end if;
end $$;

create or replace function app.create_product(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare p "Product"; v jsonb; pv "ProductVariant";
begin
  perform app.need_role(me, 'SELLER');
  if app.blank(b->>'name') or app.blank(b->>'category') then perform app.err(400, 'Name and category are required'); end if;
  if jsonb_typeof(b->'variants') is distinct from 'array' or jsonb_array_length(b->'variants') = 0 then
    perform app.err(400, 'At least one variant required');
  end if;
  for v in select * from jsonb_array_elements(b->'variants') loop perform app.check_variant(v); end loop;
  insert into "Product" ("businessId", name, category, description, "imageUrl", "isVisible")
  values (me.business_id, b->>'name', b->>'category', b->>'description', b->>'imageUrl', coalesce(app.bool(b->'isVisible'), true))
  returning * into p;
  for v in select * from jsonb_array_elements(b->'variants') loop
    insert into "ProductVariant" ("productId", name, brand, unit, "pricingType", "unitPrice")
    values (p.id, v->>'name', v->>'brand', (v->>'unit')::"SellingUnit", (v->>'pricingType')::"PricingType", round(app.num(v->'unitPrice'), 2))
    returning * into pv;
    insert into "ProductPrice" ("variantId", "unitPrice", note) values (pv.id, pv."unitPrice", 'Initial price');
  end loop;
  perform app.audit(me.business_id, me.id, 'Product', p.id, 'CREATE', jsonb_build_object('name', p.name));
  return app.j_product(p, null, false) - 'isFavourite';
end $$;

create or replace function app.update_product(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare p "Product";
begin
  perform app.need_role(me, 'SELLER');
  select * into p from "Product" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Product not found'); end if;
  update "Product" set
    name = case when b ? 'name' then b->>'name' else name end,
    category = case when b ? 'category' then b->>'category' else category end,
    description = case when b ? 'description' then b->>'description' else description end,
    "imageUrl" = case when b ? 'imageUrl' then b->>'imageUrl' else "imageUrl" end,
    "isVisible" = case when b ? 'isVisible' then coalesce(app.bool(b->'isVisible'), "isVisible") else "isVisible" end
  where id = p_id returning * into p;
  perform app.audit(me.business_id, me.id, 'Product', p_id, 'UPDATE', b);
  return app.j_product(p, null, false) - 'isFavourite';
end $$;

create or replace function app.archive_product(me app.ctx, p_id text) returns jsonb language plpgsql as $$
declare p "Product";
begin
  perform app.need_role(me, 'SELLER');
  update "Product" set "isArchived" = true, "isVisible" = false where id = p_id and "businessId" = me.business_id returning * into p;
  if not found then perform app.err(404, 'Product not found'); end if;
  perform app.audit(me.business_id, me.id, 'Product', p_id, 'ARCHIVE');
  return to_jsonb(p);
end $$;

create or replace function app.upsert_variant(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare pv "ProductVariant"; price numeric;
begin
  perform app.need_role(me, 'SELLER');
  if not exists (select 1 from "Product" where id = p_id and "businessId" = me.business_id) then perform app.err(404, 'Product not found'); end if;
  perform app.check_variant(b);
  price := round(app.num(b->'unitPrice'), 2);
  if not app.blank(b->>'id') then
    update "ProductVariant" set name = b->>'name', brand = b->>'brand', unit = (b->>'unit')::"SellingUnit",
           "pricingType" = (b->>'pricingType')::"PricingType", "unitPrice" = price, "isActive" = coalesce(app.bool(b->'isActive'), true)
     where id = b->>'id' and "productId" = p_id returning * into pv;
    if not found then perform app.err(404, 'Variant not found'); end if;
    insert into "ProductPrice" ("variantId", "unitPrice", note) values (pv.id, price, 'Price update');
    perform app.audit(me.business_id, me.id, 'ProductVariant', pv.id, 'UPDATE', jsonb_build_object('unitPrice', price::text));
  else
    insert into "ProductVariant" ("productId", name, brand, unit, "pricingType", "unitPrice")
    values (p_id, b->>'name', b->>'brand', (b->>'unit')::"SellingUnit", (b->>'pricingType')::"PricingType", price)
    returning * into pv;
    insert into "ProductPrice" ("variantId", "unitPrice", note) values (pv.id, price, 'Initial price');
    perform app.audit(me.business_id, me.id, 'ProductVariant', pv.id, 'CREATE');
  end if;
  return app.j_variant(pv);
end $$;

create or replace function app.toggle_favourite(me app.ctx, p_id text) returns jsonb language plpgsql as $$
begin
  perform app.need_role(me, 'CUSTOMER');
  if not exists (select 1 from "Product" where id = p_id and "businessId" = me.business_id) then perform app.err(404, 'Product not found'); end if;
  delete from "CustomerFavourite" where "customerId" = me.customer_id and "productId" = p_id;
  if found then return jsonb_build_object('favourited', false); end if;
  insert into "CustomerFavourite" ("customerId", "productId") values (me.customer_id, p_id);
  return jsonb_build_object('favourited', true);
end $$;

-- ---------- Customers ----------
create or replace function app.list_customers(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'SELLER');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'creditAllowed', c."creditAllowed", 'notes', c.notes,
      'orderCount', (select count(*) from "Order" o where o."customerId" = c.id),
      'outstandingBalance', (select round(coalesce(sum(o."outstandingBalance"), 0), 2)::text from "Order" o where o."customerId" = c.id),
      'isActive', u."isActive",
      'recentActivity', coalesce((select max(o."createdAt") from "Order" o where o."customerId" = c.id), c."updatedAt"),
      'createdAt', c."createdAt") order by c.name), '[]')
    from "Customer" c join "User" u on u.id = c."userId" where c."businessId" = me.business_id);
end $$;

create or replace function app.get_customer(me app.ctx, p_id text) returns jsonb language plpgsql stable as $$
declare c "Customer";
begin
  perform app.need_role(me, 'SELLER');
  select * into c from "Customer" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  return to_jsonb(c) || jsonb_build_object(
    'user', (select to_jsonb(u) - 'passwordHash' - 'authUserId' - 'pinHash' - 'pinFailedCount' from "User" u where u.id = c."userId"),
    'outstandingBalance', (select round(coalesce(sum(s."outstandingBalance"), 0), 2)::text from (
        select "outstandingBalance" from "Order" where "customerId" = c.id order by "createdAt" desc limit 20) s),
    'orders', (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object(
                  'revisions', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (
                      select * from "OrderRevision" where "orderId" = o.id order by "revisionNumber" desc limit 1) r),
                  'delivery', (select to_jsonb(d) from "Delivery" d where d."orderId" = o.id)) order by o."createdAt" desc), '[]')
               from (select * from "Order" where "customerId" = c.id order by "createdAt" desc limit 20) o));
end $$;

-- app.create_customer is defined in 20261126000007_phase1_security.sql
create or replace function app.update_customer(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare c "Customer";
begin
  perform app.need_role(me, 'SELLER');
  select * into c from "Customer" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  update "Customer" set
    name = coalesce(nullif(b->>'name', ''), name),
    "creditAllowed" = coalesce(app.bool(b->'creditAllowed'), "creditAllowed"),
    notes = case when b ? 'notes' then b->>'notes' else notes end
  where id = p_id returning * into c;
  if not app.blank(b->>'name') or app.bool(b->'isActive') is not null then
    update "User" set name = coalesce(nullif(b->>'name', ''), name), "isActive" = coalesce(app.bool(b->'isActive'), "isActive")
     where id = c."userId";
  end if;
  perform app.audit(me.business_id, me.id, 'Customer', p_id, 'UPDATE', b);
  return to_jsonb(c);
end $$;

create or replace function app.aging(me app.ctx) returns jsonb language plpgsql stable as $$
declare rows jsonb;
begin
  perform app.need_role(me, 'SELLER');
  select coalesce(jsonb_agg(r), '[]') into rows from (
    select o.id as "orderId", o."orderNumber", o."customerId", c.name as "customerName", c.phone as "customerPhone",
           round(o."outstandingBalance", 2)::text as "outstandingBalance",
           case when o."agreedTotal" is null then null else round(o."agreedTotal", 2)::text end as "agreedTotal",
           round(o."amountPaid", 2)::text as "amountPaid", o.status,
           floor(extract(epoch from (app.now_utc() - coalesce(o."agreedAt", o."createdAt"))) / 86400)::int as "daysOutstanding",
           o."agreedAt"
      from "Order" o join "Customer" c on c.id = o."customerId"
     where o."businessId" = me.business_id and o."outstandingBalance" > 0
       and o.status in ('AGREED','READY_FOR_DELIVERY','DISPATCHED','DELIVERED','COMPLETED')) r;
  return jsonb_build_object(
    'buckets', (select jsonb_object_agg(k, jsonb_build_object(
        'items', coalesce((select jsonb_agg(e) from jsonb_array_elements(rows) e where (e->>'daysOutstanding')::int between lo and hi), '[]'),
        'total', (select round(coalesce(sum((e->>'outstandingBalance')::numeric), 0), 2)::text from jsonb_array_elements(rows) e
                   where (e->>'daysOutstanding')::int between lo and hi)))
      from (values ('0-7', -2147483648, 7), ('8-14', 8, 14), ('15-30', 15, 30), ('30+', 31, 2147483647)) b(k, lo, hi)),
    'grandTotal', (select round(coalesce(sum((e->>'outstandingBalance')::numeric), 0), 2)::text from jsonb_array_elements(rows) e));
end $$;

create or replace function app.preferences(me app.ctx, b jsonb, p_update boolean) returns jsonb language plpgsql as $$
declare v boolean;
begin
  perform app.need_role(me, 'CUSTOMER');
  if p_update then
    if app.bool(b->'autoApproveUnchanged') is null then perform app.err(400, 'autoApproveUnchanged must be true or false'); end if;
    update "Customer" set "autoApproveUnchanged" = app.bool(b->'autoApproveUnchanged')
     where id = me.customer_id and "businessId" = me.business_id;
  end if;
  select "autoApproveUnchanged" into v from "Customer" where id = me.customer_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  return jsonb_build_object('autoApproveUnchanged', v);
end $$;

-- ---------- Notifications ----------
create or replace function app.my_notifications(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'CUSTOMER');
  return (select coalesce(jsonb_agg(to_jsonb(n) || jsonb_build_object('order',
            (select jsonb_build_object('id', o.id, 'orderNumber', o."orderNumber", 'status', o.status) from "Order" o where o.id = n."orderId"))
            order by n."createdAt" desc), '[]')
          from (select * from "Notification" where "recipientPhone" = me.phone and "businessId" = me.business_id
                order by "createdAt" desc limit 100) n);
end $$;

-- ---------- Reports ----------
create or replace function app.reports(me app.ctx) returns jsonb language plpgsql stable as $$
declare b text := me.business_id;
begin
  perform app.need_role(me, 'SELLER');
  return jsonb_build_object(
    'estimatedOrderRequests', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum("estimatedTotal"), 0), 2)::text)
                                 from "Order" where "businessId" = b and status not in ('DRAFT','CANCELLED')),
    'agreedSales', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum("agreedTotal"), 0), 2)::text)
                      from "Order" where "businessId" = b and "agreedTotal" is not null and status <> 'CANCELLED'),
    'deliveredSales', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum("agreedTotal"), 0), 2)::text)
                         from "Order" where "businessId" = b and status in ('DELIVERED','COMPLETED')),
    'verifiedPaymentsReceived', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum(amount), 0), 2)::text)
                                   from "Payment" where "businessId" = b),
    'outstandingDebts', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum("outstandingBalance"), 0), 2)::text)
                           from "Order" where "businessId" = b and "outstandingBalance" > 0),
    'deliveryCharges', jsonb_build_object(
        'total', (select round(coalesce(sum(r."deliveryCharge"), 0), 2)::text from "OrderRevision" r join "Order" o on o.id = r."orderId"
                   where o."businessId" = b and r."isLocked"),
        'estimatedFallback', (select round(coalesce(sum("estimatedDeliveryCharge"), 0), 2)::text from "Order"
                               where "businessId" = b and "agreedTotal" is not null and status <> 'CANCELLED')),
    'cancelledOrders', (select jsonb_build_object('count', count(*), 'total', round(coalesce(sum("estimatedTotal"), 0), 2)::text)
                          from "Order" where "businessId" = b and status = 'CANCELLED'));
end $$;

create or replace function app.settings(me app.ctx, b jsonb, p_update boolean) returns jsonb language plpgsql as $$
declare s "BusinessSettings";
begin
  perform app.need_role(me, 'SELLER');
  if p_update then
    update "BusinessSettings" set
      "approvalToleranceAbs" = coalesce(round(app.num(b->'approvalToleranceAbs'), 2), "approvalToleranceAbs"),
      "approvalTolerancePct" = coalesce(round(app.num(b->'approvalTolerancePct'), 2), "approvalTolerancePct"),
      "defaultDeliveryCharge" = coalesce(round(app.num(b->'defaultDeliveryCharge'), 2), "defaultDeliveryCharge")
    where "businessId" = me.business_id returning * into s;
    if not found then perform app.err(404, 'Settings not found'); end if;
  else
    select * into s from "BusinessSettings" where "businessId" = me.business_id;
    if not found then return 'null'::jsonb; end if;
  end if;
  return app.fix(to_jsonb(s), array['approvalToleranceAbs','approvalTolerancePct','defaultDeliveryCharge']);
end $$;

-- ---------- Auth ----------
create or replace function app.auth_me(me app.ctx) returns jsonb language sql stable as $$
  select jsonb_build_object('id', me.id, 'name', me.name, 'phone', me.phone, 'role', me.role, 'businessId', me.business_id,
    'customerId', me.customer_id,
    'business', (select jsonb_build_object('id', bz.id, 'name', bz.name, 'settings',
        (select app.fix(to_jsonb(s), array['approvalToleranceAbs','approvalTolerancePct','defaultDeliveryCharge'])
           from "BusinessSettings" s where s."businessId" = bz.id)) from "Business" bz where bz.id = me.business_id),
    'creditAllowed', (select c."creditAllowed" from "Customer" c where c.id = me.customer_id))
$$;

create or replace function app.auth_login(me app.ctx) returns jsonb language plpgsql as $$
begin
  perform app.audit(me.business_id, me.id, 'User', me.id, 'LOGIN');
  return jsonb_build_object('user', jsonb_build_object('id', me.id, 'name', me.name, 'phone', me.phone, 'role', me.role,
    'businessId', me.business_id, 'customerId', me.customer_id));
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
  if exists (select 1 from "User" where id = me.id and "mustChangePassword")
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
      if m = 'PATCH' then return app.settings(me, b, true); end if;
    end if;
  else null;
  end case;

  perform app.err(404, 'Not found');
  return null;
end $$;

-- ---------- Security lockdown: no direct table access from the browser ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
revoke execute on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;

-- ---------- Give existing users a Supabase login (same password hash) ----------
update "User" set "authUserId" = app.create_auth_user(phone, "passwordHash") where "authUserId" is null;
