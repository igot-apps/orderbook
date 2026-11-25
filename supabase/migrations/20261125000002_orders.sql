-- OrderBook on Supabase — part 2: orders (port of backend/src/services/orderService.ts)

create or replace function app.timeline(o "Order") returns jsonb language sql stable as $$
  with ev(at, seq, sub, obj) as (
    select o."createdAt", 1, 0, jsonb_build_object('type','CREATED','title','Order created')
    union all
    select o."submittedAt", 2, 0, jsonb_build_object('type','SUBMITTED','title','Order submitted',
           'detail', 'Estimated total ' || round(o."estimatedTotal", 2)::text)
      where o."submittedAt" is not null
    union all
    select coalesce(r."sentForApprovalAt", r."createdAt"), 3, r."revisionNumber" * 2,
           case when r."sentForApprovalAt" is not null then
             jsonb_build_object('type','REVISION_SENT','title', format('Revision #%s sent for approval', r."revisionNumber"),
               'detail', format('Prepared total %s (diff %s)', round(r."grandTotal",2), round(r."differenceAmount",2)),
               'actor', (select u.name from "User" u where u.id = r."preparedById"))
           else jsonb_build_object('type','REVISION_SAVED','title', format('Revision #%s saved', r."revisionNumber"),
               'actor', (select u.name from "User" u where u.id = r."preparedById")) end
      from "OrderRevision" r where r."orderId" = o.id
    union all
    select r."createdAt", 3, r."revisionNumber" * 2 + 1,
           jsonb_build_object('type','CHANGE_REQUESTED','title','Customer requested a change','detail', r."changeRequestNote")
      from "OrderRevision" r where r."orderId" = o.id and r."changeRequestNote" is not null
    union all
    select a."agreedAt", 4, 0, jsonb_build_object('type','AGREED',
             'title', case a.method when 'DIGITAL' then 'Customer accepted digitally'
                                    when 'PHONE' then 'Seller recorded telephone approval'
                                    else 'Auto-finalized within tolerance' end,
             'detail', 'Invoice total ' || round(a."agreedTotal",2)::text,
             'actor', (select u.name from "User" u where u.id = a."recordedById"))
      from "OrderAgreement" a where a."orderId" = o.id
    union all
    select pa."createdAt", 5, 0, jsonb_build_object('type','PAYMENT_ATTEMPT','title','Payment attempt ' || pa.status::text,
             'detail', format('%s via %s (%s)', round(pa.amount,2), pa.network, pa."internalReference"))
      from "PaymentAttempt" pa where pa."orderId" = o.id
    union all
    select p."paidAt", 6, 0, jsonb_build_object('type','PAYMENT_VERIFIED','title','Payment verified',
             'detail', format('%s · Receipt %s', round(p.amount,2), p."receiptNumber"))
      from "Payment" p where p."orderId" = o.id
    union all
    select d."dispatchedAt", 7, 0, jsonb_build_object('type','DISPATCHED','title','Order dispatched')
      from "Delivery" d where d."orderId" = o.id and d."dispatchedAt" is not null
    union all
    select d."deliveredAt", 8, 0, jsonb_build_object('type','DELIVERED','title','Order delivered')
      from "Delivery" d where d."orderId" = o.id and d."deliveredAt" is not null
    union all
    select n."createdAt", 9, 0, jsonb_build_object('type','NOTIFICATION_' || n.type::text,
             'title', 'Update: ' || lower(replace(n.type::text, '_', ' ')), 'detail', left(n.message, 120))
      from "Notification" n where n."orderId" = o.id
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(obj || jsonb_build_object('at', app.iso(at))) order by at, seq, sub), '[]')
  from ev
$$;

create or replace function app.get_order(me app.ctx, p_id text) returns jsonb language plpgsql stable as $$
declare o "Order";
begin
  select * into o from "Order"
   where id = p_id and "businessId" = me.business_id
     and (me.role <> 'CUSTOMER' or "customerId" = me.customer_id);
  if not found then perform app.err(404, 'Order not found'); end if;

  return app.j_order(o) || jsonb_build_object(
    'customer', (select to_jsonb(c) from "Customer" c where c.id = o."customerId"),
    'requestItems', (select coalesce(jsonb_agg(app.j_req_item(i) order by i."sortOrder"), '[]') from "OrderRequestItem" i where i."orderId" = o.id),
    'revisions', (select coalesce(jsonb_agg(app.j_rev(r, true, true) order by r."revisionNumber"), '[]') from "OrderRevision" r where r."orderId" = o.id),
    'agreements', (select coalesce(jsonb_agg(app.j_agreement(a) || jsonb_build_object(
                      'recordedBy', app.j_person(a."recordedById"),
                      'revision', (select app.fix(to_jsonb(r), array['deliveryCharge','itemsTotal','grandTotal','requestedTotal','differenceAmount','differencePercent'])
                                     from "OrderRevision" r where r.id = a."revisionId"))
                    order by a."agreedAt"), '[]') from "OrderAgreement" a where a."orderId" = o.id),
    'delivery', (select to_jsonb(d) from "Delivery" d where d."orderId" = o.id),
    'paymentAttempts', (select coalesce(jsonb_agg(app.j_attempt(pa) order by pa."createdAt" desc), '[]') from "PaymentAttempt" pa where pa."orderId" = o.id),
    'payments', (select coalesce(jsonb_agg(app.j_payment(p) || jsonb_build_object('allocations',
                    (select coalesce(jsonb_agg(app.fix(to_jsonb(al), array['amount'])), '[]') from "PaymentAllocation" al where al."paymentId" = p.id))
                  order by p."paidAt" desc), '[]') from "Payment" p where p."orderId" = o.id),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(n) order by n."createdAt"), '[]') from "Notification" n where n."orderId" = o.id),
    'timeline', app.timeline(o)
  );
end $$;

-- GET /orders
create or replace function app.list_orders(me app.ctx, q jsonb) returns jsonb language plpgsql stable as $$
declare
  v_customer text := case when me.role = 'CUSTOMER' then me.customer_id else nullif(q->>'customerId', '') end;
  v_status text[] := case when coalesce(q->>'status', '') = '' then null else string_to_array(q->>'status', ',') end;
  v_q text := nullif(q->>'q', '');
  v_page int; v_size int; rows jsonb;
begin
  if q ? 'page' then
    begin
      v_page := (q->>'page')::int;
      v_size := coalesce(nullif(q->>'pageSize', '')::int, 25);
    exception when others then perform app.err(400, 'Invalid page');
    end;
    if v_page < 1 or v_page > 100000 or v_size < 1 or v_size > 100 then perform app.err(400, 'Invalid page'); end if;

    select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object('customer', to_jsonb(c)) order by o."createdAt" desc, o.id desc), '[]')
      into rows
      from (select o.* from "Order" o join "Customer" c on c.id = o."customerId"
             where o."businessId" = me.business_id
               and (v_customer is null or o."customerId" = v_customer)
               and (v_status is null or o.status::text = any(v_status))
               and (v_q is null or o."orderNumber" ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%' or c.phone like '%' || v_q || '%')
             order by o."createdAt" desc, o.id desc
             offset (v_page - 1) * v_size limit v_size + 1) o
      join "Customer" c on c.id = o."customerId";
    return jsonb_build_object(
      'items', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(rows) with ordinality t(e, i) where i <= v_size order by i) s), '[]'),
      'hasMore', jsonb_array_length(rows) > v_size,
      'page', v_page);
  end if;

  return (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object(
            'customer', to_jsonb(c),
            'requestItems', (select coalesce(jsonb_agg(app.j_req_item(i)), '[]') from "OrderRequestItem" i where i."orderId" = o.id),
            'revisions', app.j_latest_rev(o.id, true),
            'delivery', (select to_jsonb(d) from "Delivery" d where d."orderId" = o.id),
            'agreements', (select coalesce(jsonb_agg(app.j_agreement(a)), '[]') from (
                             select * from "OrderAgreement" where "orderId" = o.id order by "agreedAt" desc limit 1) a))
          order by o."createdAt" desc, o.id desc), '[]')
    from "Order" o join "Customer" c on c.id = o."customerId"
   where o."businessId" = me.business_id
     and (v_customer is null or o."customerId" = v_customer)
     and (v_status is null or o.status::text = any(v_status))
     and (v_q is null or o."orderNumber" ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%' or c.phone like '%' || v_q || '%'));
end $$;

-- POST /orders
create or replace function app.create_order(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare
  v_customer_id text; cust "Customer"; it record; v record; built jsonb := '[]';
  req numeric; total numeric := 0; delivery numeric; v_submit boolean; v_number text; o "Order"; nm text;
begin
  if me.role = 'CUSTOMER' then v_customer_id := me.customer_id;
  else
    v_customer_id := nullif(b->>'customerId', '');
    if v_customer_id is null then perform app.err(403, 'customerId required'); end if;
  end if;
  if jsonb_typeof(b->'items') is distinct from 'array' or jsonb_array_length(b->'items') = 0 then
    perform app.err(400, 'Add at least one item');
  end if;
  select * into cust from "Customer" where id = v_customer_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;

  for it in select value as item, (ordinality - 1)::int as idx from jsonb_array_elements(b->'items') with ordinality loop
    req := round(app.num(it.item->'requestedAmount'), 2);
    if req is null or req <= 0 then perform app.err(400, 'Requested amount must be positive'); end if;

    if coalesce(app.bool(it.item->'isCustom'), false) or app.blank(it.item->>'variantId') then
      nm := btrim(coalesce(it.item->>'customName', ''));
      if nm = '' then perform app.err(400, 'Custom item name required'); end if;
      built := built || jsonb_build_object('productId', null, 'variantId', null, 'isCustom', true,
        'productNameSnapshot', nm, 'variantNameSnapshot', null, 'brandSnapshot', null,
        'unitSnapshot', coalesce(nullif(it.item->>'customUnit', ''), 'PIECE'), 'pricingTypeSnapshot', 'FIXED_UNIT',
        'catalogueUnitPrice', req, 'requestedAmount', req, 'estimatedQuantity', 1,
        'note', it.item->>'note', 'sortOrder', it.idx);
    else
      select pv.*, p.name as p_name, p."businessId" as p_biz, p."isArchived" as p_archived
        into v from "ProductVariant" pv join "Product" p on p.id = pv."productId"
       where pv.id = it.item->>'variantId' and pv."isActive";
      if not found or v.p_biz <> me.business_id then
        perform app.err(400, 'Variant not found: ' || (it.item->>'variantId'));
      end if;
      if v.p_archived then perform app.err(400, v.p_name || ' is archived'); end if;
      built := built || jsonb_build_object('productId', v."productId", 'variantId', v.id, 'isCustom', false,
        'productNameSnapshot', v.p_name, 'variantNameSnapshot', v.name, 'brandSnapshot', v.brand,
        'unitSnapshot', v.unit, 'pricingTypeSnapshot', v."pricingType",
        'catalogueUnitPrice', round(v."unitPrice", 2), 'requestedAmount', req,
        'estimatedQuantity', case when v."unitPrice" <= 0 then 0 else round(req / v."unitPrice", 4) end,
        'note', it.item->>'note', 'sortOrder', it.idx);
    end if;
    total := total + req;
  end loop;

  delivery := round(coalesce(app.num(b->'estimatedDeliveryCharge'), 0), 2);
  if delivery < 0 then perform app.err(400, 'Delivery charge cannot be negative'); end if;
  v_submit := coalesce(app.bool(b->'submit'), true);
  select 'OP-' || lpad((count(*) + 1)::text, 5, '0') into v_number from "Order" where "businessId" = me.business_id;

  insert into "Order" ("businessId","customerId","orderNumber","status","deliveryInstructions","estimatedDeliveryCharge",
                       "requestedItemsTotal","estimatedTotal","submittedAt")
  values (me.business_id, v_customer_id, v_number, (case when v_submit then 'SUBMITTED' else 'DRAFT' end)::"OrderStatus",
          b->>'deliveryInstructions', delivery, round(total, 2), round(total + delivery, 2),
          case when v_submit then app.now_utc() end)
  returning * into o;

  insert into "OrderRequestItem" ("orderId","productId","variantId","isCustom","productNameSnapshot","variantNameSnapshot",
    "brandSnapshot","unitSnapshot","pricingTypeSnapshot","catalogueUnitPrice","requestedAmount","estimatedQuantity","note","sortOrder")
  select o.id, x."productId", x."variantId", x."isCustom", x."productNameSnapshot", x."variantNameSnapshot", x."brandSnapshot",
         x."unitSnapshot", x."pricingTypeSnapshot", x."catalogueUnitPrice", x."requestedAmount", x."estimatedQuantity", x.note, x."sortOrder"
    from jsonb_to_recordset(built) as x("productId" text, "variantId" text, "isCustom" boolean, "productNameSnapshot" text,
      "variantNameSnapshot" text, "brandSnapshot" text, "unitSnapshot" "SellingUnit", "pricingTypeSnapshot" "PricingType",
      "catalogueUnitPrice" numeric, "requestedAmount" numeric, "estimatedQuantity" numeric, note text, "sortOrder" int);

  update "Product" set "usageCount" = "usageCount" + 1, "lastUsedAt" = app.now_utc()
   where id in (select distinct x->>'productId' from jsonb_array_elements(built) x where x->>'productId' is not null);

  perform app.audit(me.business_id, me.id, 'Order', o.id, case when v_submit then 'SUBMIT' else 'CREATE_DRAFT' end,
                    jsonb_build_object('orderNumber', v_number, 'estimatedTotal', round(total + delivery, 2)::text));
  if v_submit then
    perform app.notify(me.business_id, cust.phone, 'ORDER_RECEIVED',
      format('OrderBook: We received order %s. Estimated total %s. Your order is being prepared.', v_number, app.ghs(total + delivery)),
      o.id, null, '/customer/orders/' || o.id);
  end if;

  return app.j_order(o) || jsonb_build_object(
    'customer', to_jsonb(cust),
    'requestItems', (select coalesce(jsonb_agg(app.j_req_item(i) order by i."sortOrder"), '[]') from "OrderRequestItem" i where i."orderId" = o.id));
end $$;

-- POST /orders/:id/prepare/start
create or replace function app.start_preparing(me app.ctx, p_id text) returns jsonb language plpgsql as $$
declare o "Order";
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  if o.status::text not in ('SUBMITTED','CHANGE_REQUESTED','PREPARING','AWAITING_CUSTOMER_APPROVAL') then
    perform app.assert_transition(o.status::text, 'PREPARING');
  end if;
  if o.status::text in ('SUBMITTED','CHANGE_REQUESTED') then
    update "Order" set status = 'PREPARING' where id = p_id;
  end if;
  perform app.audit(me.business_id, me.id, 'Order', p_id, 'START_PREPARING');
  return app.get_order(me, p_id);
end $$;

-- POST /orders/:id/prepare
create or replace function app.save_preparation(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare
  o "Order"; cust "Customer"; orig "OrderRequestItem"; it record; items jsonb := b->'items';
  built jsonb := '[]'; n_orig int; ids text[]; reason text; removed boolean; confirmed numeric; actual numeric; line numeric;
  diff_amt numeric; items_total numeric := 0; delivery numeric; grand numeric; requested numeric; d_amt numeric; d_pct numeric;
  next_rev int; unchanged boolean; needs boolean; v_send boolean; v_auto boolean; rev "OrderRevision"; x jsonb;
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  select * into cust from "Customer" where id = o."customerId";

  if o.status::text not in ('SUBMITTED','PREPARING','CHANGE_REQUESTED','AWAITING_CUSTOMER_APPROVAL','AGREED') then
    perform app.err(400, 'Cannot prepare order in status ' || o.status::text);
  end if;
  if o.status = 'AGREED' and o."amountPaid" <> 0 then
    perform app.err(400, 'An invoice with recorded payments cannot be revised');
  end if;
  if o.status::text in ('SUBMITTED','CHANGE_REQUESTED','AGREED') then
    perform app.assert_transition(o.status::text, 'PREPARING');
  end if;

  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) = 0 then
    perform app.err(400, 'Preparation items required');
  end if;
  select count(*) into n_orig from "OrderRequestItem" where "orderId" = o.id;
  select array_agg(e->>'requestItemId') into ids from jsonb_array_elements(items) e where not app.blank(e->>'requestItemId');
  ids := coalesce(ids, '{}');
  if (select count(distinct u) from unnest(ids) u) <> cardinality(ids)
     or cardinality(ids) <> n_orig
     or exists (select 1 from unnest(ids) u where not exists (select 1 from "OrderRequestItem" r where r.id = u and r."orderId" = o.id)) then
    perform app.err(400, 'Invoice must include each original request item exactly once');
  end if;
  if exists (select 1 from jsonb_array_elements(items) e where app.blank(e->>'requestItemId') or coalesce(app.bool(e->'isReplacement'), false)) then
    perform app.err(400, 'Replacement items are not supported in this invoice flow');
  end if;

  for it in select value as item, (ordinality - 1)::int as idx from jsonb_array_elements(items) with ordinality loop
    select * into orig from "OrderRequestItem" where id = it.item->>'requestItemId';
    reason := it.item->>'priceChangeReason';
    removed := coalesce(app.bool(it.item->'isRemoved'), false);
    if removed and app.blank(reason) then
      perform app.err(400, 'Reason required to remove ' || orig."productNameSnapshot");
    end if;
    confirmed := round(app.num(it.item->'confirmedUnitPrice'), 2);
    if not removed and (confirmed is null or confirmed <= 0) then
      perform app.err(400, 'Unit price must be positive for ' || orig."productNameSnapshot");
    end if;
    if confirmed is distinct from round(orig."catalogueUnitPrice", 2) and coalesce(reason, '') = '' and not removed then
      perform app.err(400, 'Price change reason required for ' || coalesce(it.item->>'productNameSnapshot', orig."productNameSnapshot"));
    end if;
    actual := case when removed then 0 else round(app.num(it.item->'actualQuantity'), 4) end;
    if not removed and (actual is null or actual <= 0) then
      perform app.err(400, 'Quantity must be positive for ' || orig."productNameSnapshot");
    end if;
    line := case when removed then 0 else round(actual * confirmed, 2) end;
    diff_amt := round(line - orig."requestedAmount", 2);
    if (diff_amt <> 0 or actual <> orig."estimatedQuantity") and app.blank(reason) and not removed then
      perform app.err(400, 'Adjustment reason required for ' || coalesce(it.item->>'productNameSnapshot', orig."productNameSnapshot"));
    end if;
    built := built || jsonb_build_object(
      'requestItemId', orig.id, 'productNameSnapshot', orig."productNameSnapshot", 'variantNameSnapshot', orig."variantNameSnapshot",
      'brandSnapshot', orig."brandSnapshot", 'unitSnapshot', orig."unitSnapshot", 'pricingTypeSnapshot', orig."pricingTypeSnapshot",
      'catalogueUnitPrice', round(orig."catalogueUnitPrice", 2), 'confirmedUnitPrice', coalesce(confirmed, 0),
      'priceChangeReason', reason, 'requestedAmount', round(orig."requestedAmount", 2),
      'estimatedQuantity', round(orig."estimatedQuantity", 4), 'actualQuantity', actual, 'actualLineTotal', line,
      'differenceAmount', diff_amt, 'isRemoved', removed, 'isReplacement', coalesce(app.bool(it.item->'isReplacement'), false),
      'note', coalesce(it.item->>'note', orig.note), 'sortOrder', it.idx);
    if not removed then items_total := items_total + line; end if;
  end loop;

  items_total := round(items_total, 2);
  if not exists (select 1 from jsonb_array_elements(built) e where not (e->>'isRemoved')::boolean) then
    perform app.err(400, 'Cancel the order if no requested items can be supplied');
  end if;
  delivery := round(coalesce(app.num(b->'deliveryCharge'), o."estimatedDeliveryCharge"), 2);
  if delivery < 0 then perform app.err(400, 'Delivery charge cannot be negative'); end if;
  grand := round(items_total + delivery, 2);
  requested := round(o."requestedItemsTotal" + o."estimatedDeliveryCharge", 2);
  d_amt := round(grand - requested, 2);
  d_pct := case when requested = 0 then 0 else round(d_amt / requested * 100, 2) end;
  select coalesce(max("revisionNumber"), 0) + 1 into next_rev from "OrderRevision" where "orderId" = o.id;

  -- Auto-approval only for an invoice identical to the request, line by line.
  unchanged := not exists (
    select 1 from jsonb_array_elements(built) e join "OrderRequestItem" r on r.id = e->>'requestItemId'
     where (e->>'isRemoved')::boolean or (e->>'isReplacement')::boolean
        or (e->>'actualQuantity')::numeric <> r."estimatedQuantity"
        or (e->>'confirmedUnitPrice')::numeric <> r."catalogueUnitPrice"
        or (e->>'actualLineTotal')::numeric <> r."requestedAmount");
  needs := not unchanged or delivery <> o."estimatedDeliveryCharge" or requested <> grand;
  v_send := coalesce(app.bool(b->'sendForApproval'), false);
  v_auto := v_send and not needs and cust."autoApproveUnchanged";

  if o.status::text in ('SUBMITTED','CHANGE_REQUESTED','AGREED') then
    if o.status = 'AGREED' then
      update "Order" set status = 'PREPARING', "agreedTotal" = null, "outstandingBalance" = 0, "agreedAt" = null, "isPaid" = false where id = o.id;
    else
      update "Order" set status = 'PREPARING' where id = o.id;
    end if;
  end if;

  insert into "OrderRevision" ("orderId","revisionNumber","preparedById","deliveryCharge","itemsTotal","grandTotal","requestedTotal",
    "differenceAmount","differencePercent","preparationNote","isLocked","sentForApprovalAt")
  values (o.id, next_rev, me.id, delivery, items_total, grand, requested, d_amt, d_pct, b->>'preparationNote', v_auto,
          case when v_send then app.now_utc() end)
  returning * into rev;

  insert into "OrderRevisionItem" ("revisionId","requestItemId","productNameSnapshot","variantNameSnapshot","brandSnapshot","unitSnapshot",
    "pricingTypeSnapshot","catalogueUnitPrice","confirmedUnitPrice","priceChangeReason","requestedAmount","estimatedQuantity",
    "actualQuantity","actualLineTotal","differenceAmount","isRemoved","isReplacement","note","sortOrder")
  select rev.id, x."requestItemId", x."productNameSnapshot", x."variantNameSnapshot", x."brandSnapshot", x."unitSnapshot",
         x."pricingTypeSnapshot", x."catalogueUnitPrice", x."confirmedUnitPrice", x."priceChangeReason", x."requestedAmount",
         x."estimatedQuantity", x."actualQuantity", x."actualLineTotal", x."differenceAmount", x."isRemoved", x."isReplacement", x.note, x."sortOrder"
    from jsonb_to_recordset(built) as x("requestItemId" text, "productNameSnapshot" text, "variantNameSnapshot" text, "brandSnapshot" text,
      "unitSnapshot" "SellingUnit", "pricingTypeSnapshot" "PricingType", "catalogueUnitPrice" numeric, "confirmedUnitPrice" numeric,
      "priceChangeReason" text, "requestedAmount" numeric, "estimatedQuantity" numeric, "actualQuantity" numeric, "actualLineTotal" numeric,
      "differenceAmount" numeric, "isRemoved" boolean, "isReplacement" boolean, note text, "sortOrder" int);

  for x in select e from jsonb_array_elements(built) e where coalesce(e->>'priceChangeReason', '') <> '' loop
    perform app.audit(me.business_id, me.id, 'OrderRevisionItem', rev.id, 'PRICE_CHANGE', jsonb_build_object(
      'product', x->>'productNameSnapshot', 'catalogueUnitPrice', round((x->>'catalogueUnitPrice')::numeric, 2)::text,
      'confirmedUnitPrice', round((x->>'confirmedUnitPrice')::numeric, 2)::text, 'reason', x->>'priceChangeReason'));
  end loop;

  if v_send and not v_auto then
    update "Order" set status = 'AWAITING_CUSTOMER_APPROVAL' where id = o.id;
  end if;
  if v_auto then
    insert into "OrderAgreement" ("orderId","revisionId","method","recordedById","agreedTotal","phoneNote")
    values (o.id, rev.id, 'AUTO_WITHIN_TOLERANCE', me.id, grand, 'Automatically approved: every invoice line matches the customer request');
    update "Order" set status = 'AGREED', "agreedTotal" = grand, "outstandingBalance" = grand, "amountPaid" = 0,
                       "isPaid" = (grand = 0), "agreedAt" = app.now_utc() where id = o.id;
    insert into "Delivery" ("orderId","status","instructions") values (o.id, 'PENDING', o."deliveryInstructions")
      on conflict ("orderId") do nothing;
  end if;

  perform app.audit(me.business_id, me.id, 'Order', o.id,
    case when v_send then case when v_auto then 'AUTO_FINALIZE' else 'SEND_FOR_APPROVAL' end else 'SAVE_PREPARATION' end,
    jsonb_build_object('revisionNumber', next_rev, 'grandTotal', grand::text, 'needsApproval', needs));

  if v_send and not v_auto then
    perform app.notify(me.business_id, cust.phone, 'AWAITING_APPROVAL',
      format('OrderBook: Order %s is ready for your approval. Prepared total %s (was %s). Review and accept:', o."orderNumber", app.ghs(grand), app.ghs(requested)),
      o.id, null, '/customer/orders/' || o.id || '/approve');
  end if;
  if v_auto then
    perform app.notify(me.business_id, cust.phone, 'ORDER_FINALIZED',
      format('OrderBook: Order %s finalized at %s. Pay here:', o."orderNumber", app.ghs(grand)), o.id, null, '/pay/' || o.id);
    perform app.notify(me.business_id, cust.phone, 'PAYMENT_LINK',
      format('OrderBook: Payment link for %s — %s outstanding.', o."orderNumber", app.ghs(grand)), o.id, null, '/pay/' || o.id);
  end if;

  return app.get_order(me, o.id);
end $$;

-- Shared "agree this revision" step (customer accept / seller phone approval).
create or replace function app.agree_revision(o "Order", rev "OrderRevision", p_method text, p_actor text, p_customer_note text, p_phone_note text)
returns void language plpgsql as $$
declare grand numeric := round(rev."grandTotal", 2);
begin
  perform app.assert_transition('AWAITING_CUSTOMER_APPROVAL', 'AGREED');
  update "OrderRevision" set "isLocked" = true where id = rev.id;
  insert into "OrderAgreement" ("orderId","revisionId","method","recordedById","customerNote","phoneNote","agreedTotal")
  values (o.id, rev.id, p_method::"AgreementMethod", p_actor, p_customer_note, p_phone_note, grand);
  update "Order" set status = 'AGREED', "agreedTotal" = grand, "outstandingBalance" = grand, "amountPaid" = 0,
                     "isPaid" = (grand = 0), "agreedAt" = app.now_utc() where id = o.id;
  insert into "Delivery" ("orderId","status","instructions") values (o.id, 'PENDING', o."deliveryInstructions")
    on conflict ("orderId") do update set instructions = excluded.instructions;
end $$;

-- POST /orders/:id/respond
create or replace function app.customer_respond(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; cust "Customer"; rev "OrderRevision"; v_action text := b->>'action'; v_msg text := b->>'message'; grand numeric;
begin
  perform app.need_role(me, 'CUSTOMER');
  if v_action is null or v_action not in ('ACCEPT','REQUEST_CHANGE') then perform app.err(400, 'Invalid action'); end if;
  select * into o from "Order" where id = p_id and "businessId" = me.business_id and "customerId" = me.customer_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  select * into cust from "Customer" where id = o."customerId";
  if o.status <> 'AWAITING_CUSTOMER_APPROVAL' then perform app.err(400, 'Order is not awaiting approval'); end if;
  select * into rev from "OrderRevision" where "orderId" = o.id and "sentForApprovalAt" is not null order by "revisionNumber" desc limit 1;
  if not found then perform app.err(400, 'No revision pending approval'); end if;
  if exists (select 1 from "OrderAgreement" where "revisionId" = rev.id) then perform app.err(400, 'Revision already agreed'); end if;
  if rev."isLocked" then perform app.err(400, 'Revision is locked'); end if;

  if v_action = 'REQUEST_CHANGE' then
    if app.blank(v_msg) then perform app.err(400, 'Please describe the change you need'); end if;
    perform app.assert_transition('AWAITING_CUSTOMER_APPROVAL', 'CHANGE_REQUESTED');
    update "OrderRevision" set "changeRequestNote" = v_msg where id = rev.id;
    update "Order" set status = 'CHANGE_REQUESTED' where id = o.id;
    perform app.audit(me.business_id, me.id, 'Order', o.id, 'CUSTOMER_CHANGE_REQUEST', jsonb_build_object('message', v_msg, 'revisionId', rev.id));
    perform app.notify(me.business_id, cust.phone, 'CHANGE_REQUESTED',
      format('OrderBook: Change requested on %s. The seller will revise and send an update.', o."orderNumber"), o.id, null, '/customer/orders/' || o.id);
    return app.get_order(me, o.id);
  end if;

  grand := round(rev."grandTotal", 2);
  perform app.agree_revision(o, rev, 'DIGITAL', me.id, v_msg, null);
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'CUSTOMER_ACCEPT', jsonb_build_object('revisionId', rev.id, 'agreedTotal', grand::text));
  perform app.notify(me.business_id, cust.phone, 'ORDER_FINALIZED',
    format('OrderBook: You accepted order %s. Final total %s.', o."orderNumber", app.ghs(grand)), o.id, null, '/customer/orders/' || o.id);
  perform app.notify(me.business_id, cust.phone, 'PAYMENT_LINK',
    format('OrderBook: Pay %s for %s:', app.ghs(grand), o."orderNumber"), o.id, null, '/pay/' || o.id);
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/flag-price
create or replace function app.flag_price(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; rev "OrderRevision"; v_msg text := btrim(coalesce(b->>'message', ''));
begin
  perform app.need_role(me, 'CUSTOMER');
  if v_msg = '' then perform app.err(400, 'Please explain the price issue'); end if;
  select * into o from "Order" where id = p_id and "businessId" = me.business_id and "customerId" = me.customer_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  if o.status <> 'AGREED' then perform app.err(400, 'Only an agreed order can be flagged'); end if;
  if o."amountPaid" <> 0 then perform app.err(400, 'Contact the seller directly because a payment has already been recorded'); end if;
  select * into rev from "OrderRevision" where "orderId" = o.id order by "revisionNumber" desc limit 1;
  if not found then perform app.err(400, 'No agreed revision found'); end if;
  perform app.assert_transition('AGREED', 'CHANGE_REQUESTED');
  update "OrderRevision" set "changeRequestNote" = v_msg where id = rev.id;
  update "Order" set status = 'CHANGE_REQUESTED', "agreedTotal" = null, "outstandingBalance" = 0, "agreedAt" = null where id = o.id;
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'CUSTOMER_FLAG_PRICE', jsonb_build_object('message', v_msg, 'revisionId', rev.id));
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/agree-phone
create or replace function app.agree_phone(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; cust "Customer"; rev "OrderRevision"; v_note text := b->>'note'; grand numeric;
begin
  perform app.need_role(me, 'SELLER');
  if app.blank(v_note) then perform app.err(400, 'Phone approval note is required'); end if;
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  select * into cust from "Customer" where id = o."customerId";
  if o.status <> 'AWAITING_CUSTOMER_APPROVAL' then perform app.err(400, 'Order is not awaiting approval'); end if;
  if not app.blank(b->>'revisionId') then
    select * into rev from "OrderRevision" where id = b->>'revisionId' and "orderId" = o.id;
  else
    select * into rev from "OrderRevision" where "orderId" = o.id and "sentForApprovalAt" is not null order by "revisionNumber" desc limit 1;
  end if;
  if rev.id is null then perform app.err(400, 'No revision to agree'); end if;
  if rev."isLocked" or exists (select 1 from "OrderAgreement" where "revisionId" = rev.id) then perform app.err(400, 'Revision already locked'); end if;

  grand := round(rev."grandTotal", 2);
  perform app.agree_revision(o, rev, 'PHONE', me.id, null, v_note);
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'PHONE_AGREEMENT', jsonb_build_object('note', v_note, 'revisionId', rev.id));
  perform app.notify(me.business_id, cust.phone, 'ORDER_FINALIZED',
    format('OrderBook: Order %s approved by phone. Final total %s.', o."orderNumber", app.ghs(grand)), o.id, null, '/pay/' || o.id);
  perform app.notify(me.business_id, cust.phone, 'PAYMENT_LINK',
    format('OrderBook: Pay %s for %s:', app.ghs(grand), o."orderNumber"), o.id, null, '/pay/' || o.id);
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/ready
create or replace function app.mark_ready(me app.ctx, p_id text) returns jsonb language plpgsql as $$
declare o "Order"; cust "Customer";
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  select * into cust from "Customer" where id = o."customerId";
  perform app.assert_transition(o.status::text, 'READY_FOR_DELIVERY');
  update "Order" set status = 'READY_FOR_DELIVERY' where id = o.id;
  insert into "Delivery" ("orderId","status","instructions") values (o.id, 'READY', o."deliveryInstructions")
    on conflict ("orderId") do update set status = 'READY';
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'READY_FOR_DELIVERY');
  perform app.notify(me.business_id, cust.phone, 'ORDER_READY',
    format('OrderBook: Order %s is ready for delivery.', o."orderNumber"), o.id, null, '/customer/orders/' || o.id);
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/dispatch
create or replace function app.dispatch_order(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; cust "Customer";
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  select * into cust from "Customer" where id = o."customerId";
  perform app.assert_transition(o.status::text, 'DISPATCHED');
  update "Order" set status = 'DISPATCHED' where id = o.id;
  insert into "Delivery" ("orderId","status","dispatchedAt","courierName","courierPhone","instructions")
  values (o.id, 'DISPATCHED', app.now_utc(), b->>'courierName', b->>'courierPhone', o."deliveryInstructions")
  on conflict ("orderId") do update set status = 'DISPATCHED', "dispatchedAt" = app.now_utc(),
    "courierName" = excluded."courierName", "courierPhone" = excluded."courierPhone";
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'DISPATCH', b);
  perform app.notify(me.business_id, cust.phone, 'ORDER_DISPATCHED',
    format('OrderBook: Order %s is on the way.', o."orderNumber"), o.id, null, '/customer/orders/' || o.id);
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/deliver
create or replace function app.deliver_order(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; cust "Customer"; prepared jsonb;
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;

  -- Completing an untouched request creates an invoice from the original requested values.
  if o.status = 'SUBMITTED' then
    prepared := app.save_preparation(me, p_id, jsonb_build_object(
      'sendForApproval', true,
      'deliveryCharge', round(o."estimatedDeliveryCharge", 2)::text,
      'preparationNote', 'Completed without changes to the customer request',
      'items', (select jsonb_agg(jsonb_build_object(
          'requestItemId', i.id, 'productNameSnapshot', i."productNameSnapshot",
          'confirmedUnitPrice', i."catalogueUnitPrice"::text, 'actualQuantity', i."estimatedQuantity"::text, 'note', i.note)
          order by i."sortOrder") from "OrderRequestItem" i where i."orderId" = p_id)));
    if prepared->>'status' <> 'AGREED' then return prepared; end if;
    select * into o from "Order" where id = p_id;
  end if;

  select * into cust from "Customer" where id = o."customerId";
  perform app.assert_transition(o.status::text, 'DELIVERED');
  update "Order" set status = 'COMPLETED', "completedAt" = app.now_utc() where id = o.id;
  update "Delivery" set status = 'DELIVERED', "deliveredAt" = app.now_utc(), "proofNote" = b->>'proofNote' where "orderId" = o.id;
  if not found then perform app.err(404, 'Delivery record not found'); end if;
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'COMPLETE', b);
  perform app.notify(me.business_id, cust.phone, 'ORDER_DELIVERED',
    format('OrderBook: Order %s has been completed. Thank you!', o."orderNumber"), o.id, null, '/customer/orders/' || o.id);
  return app.get_order(me, o.id);
end $$;

-- POST /orders/:id/cancel
create or replace function app.cancel_order(me app.ctx, p_id text, b jsonb) returns jsonb language plpgsql as $$
declare o "Order";
begin
  perform app.need_role(me, 'SELLER');
  select * into o from "Order" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Order not found'); end if;
  if o."amountPaid" <> 0 then perform app.err(400, 'An order with recorded payments cannot be cancelled'); end if;
  perform app.assert_transition(o.status::text, 'CANCELLED');
  update "Order" set status = 'CANCELLED', "cancelledAt" = app.now_utc(), "cancelReason" = b->>'reason' where id = o.id;
  perform app.audit(me.business_id, me.id, 'Order', o.id, 'CANCEL', jsonb_build_object('reason', b->>'reason'));
  return app.get_order(me, o.id);
end $$;

-- GET /orders/dashboard/seller
create or replace function app.seller_dashboard(me app.ctx) returns jsonb language plpgsql stable as $$
declare day_start timestamp := date_trunc('day', app.now_utc());
begin
  perform app.need_role(me, 'SELLER');
  return jsonb_build_object(
    'counts', (select jsonb_object_agg(s, (select count(*) from "Order" o where o."businessId" = me.business_id and o.status::text = s))
                 from unnest(array['SUBMITTED','PREPARING','AWAITING_CUSTOMER_APPROVAL','CHANGE_REQUESTED','AGREED','READY_FOR_DELIVERY','DISPATCHED','DELIVERED']) s),
    'deliveredUnpaid', (select count(*) from "Order" where "businessId" = me.business_id and status in ('DELIVERED','COMPLETED') and not "isPaid"),
    'paymentsTodayTotal', (select round(coalesce(sum(amount), 0), 2)::text from "Payment" where "businessId" = me.business_id and "paidAt" >= day_start),
    'paymentsTodayCount', (select count(*) from "Payment" where "businessId" = me.business_id and "paidAt" >= day_start),
    'totalOutstanding', (select round(coalesce(sum("outstandingBalance"), 0), 2)::text from "Order"
                          where "businessId" = me.business_id and "outstandingBalance" > 0 and status not in ('CANCELLED','DRAFT')),
    'attention', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', o.id, 'orderNumber', o."orderNumber", 'status', o.status, 'customerName', c.name,
                    'estimatedTotal', round(o."estimatedTotal", 2)::text,
                    'agreedTotal', case when o."agreedTotal" is null then null else round(o."agreedTotal", 2)::text end,
                    'outstandingBalance', round(o."outstandingBalance", 2)::text, 'updatedAt', o."updatedAt")
                    order by o."updatedAt" desc), '[]')
                  from (select * from "Order" where "businessId" = me.business_id
                          and status in ('SUBMITTED','AWAITING_CUSTOMER_APPROVAL','CHANGE_REQUESTED','READY_FOR_DELIVERY')
                        order by "updatedAt" desc limit 10) o join "Customer" c on c.id = o."customerId"));
end $$;

-- GET /orders/dashboard/customer
create or replace function app.customer_dashboard(me app.ctx) returns jsonb language plpgsql stable as $$
declare cust "Customer";
begin
  perform app.need_role(me, 'CUSTOMER');
  select * into cust from "Customer" where id = me.customer_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Customer not found'); end if;
  return jsonb_build_object(
    'customer', jsonb_build_object('id', cust.id, 'name', cust.name, 'phone', cust.phone),
    'outstandingBalance', (select round(coalesce(sum("outstandingBalance"), 0), 2)::text from "Order" where "customerId" = cust.id and "businessId" = me.business_id),
    'needingApproval', (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object('revisions', app.j_latest_rev(o.id, false)) order by o."createdAt" desc), '[]')
                          from (select * from "Order" where "customerId" = cust.id and "businessId" = me.business_id
                                  and status = 'AWAITING_CUSTOMER_APPROVAL' order by "createdAt" desc limit 20) o),
    'activeOrders', (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object('revisions', app.j_latest_rev(o.id, false)) order by o."createdAt" desc), '[]')
                       from (select * from "Order" where "customerId" = cust.id and "businessId" = me.business_id
                               and status in ('SUBMITTED','PREPARING','AWAITING_CUSTOMER_APPROVAL','CHANGE_REQUESTED','AGREED','READY_FOR_DELIVERY','DISPATCHED')
                             order by "createdAt" desc limit 20) o),
    'recentOrders', (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object('revisions', app.j_latest_rev(o.id, false)) order by o."createdAt" desc), '[]')
                       from (select * from "Order" where "customerId" = cust.id and "businessId" = me.business_id
                             order by "createdAt" desc limit 8) o));
end $$;
