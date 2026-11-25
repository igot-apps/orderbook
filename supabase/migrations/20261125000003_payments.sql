-- OrderBook on Supabase — part 3: payments (port of backend/src/services/paymentService.ts)

-- GET /payments/order/:orderId
create or replace function app.payment_page(me app.ctx, p_order text) returns jsonb language plpgsql stable as $$
declare o "Order"; c "Customer"; bz "Business";
begin
  select * into o from "Order" where id = p_order;
  if not found then perform app.err(404, 'Order not found'); end if;
  if o."agreedTotal" is null or o.status::text not in ('AGREED','DELIVERED','COMPLETED') then
    perform app.err(400, 'Order is not ready for payment');
  end if;
  if me.business_id <> o."businessId" or (me.role = 'CUSTOMER' and me.customer_id is distinct from o."customerId") then
    perform app.err(403, 'This order belongs to another account');
  end if;
  select * into c from "Customer" where id = o."customerId";
  select * into bz from "Business" where id = o."businessId";
  return jsonb_build_object(
    'orderId', o.id, 'businessId', o."businessId", 'customerId', o."customerId", 'orderNumber', o."orderNumber",
    'businessName', bz.name, 'customerName', c.name, 'customerPhone', c.phone, 'status', o.status,
    'finalTotal', round(o."agreedTotal", 2)::text, 'amountPaid', round(o."amountPaid", 2)::text,
    'outstandingBalance', round(o."outstandingBalance", 2)::text, 'isPaid', o."isPaid",
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', round(p.amount, 2)::text, 'network', p.network,
                   'receiptNumber', p."receiptNumber", 'paidAt', p."paidAt", 'providerReference', p."providerReference") order by p."paidAt" desc), '[]')
                 from "Payment" p where p."orderId" = o.id),
    'recentAttempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'internalReference', a."internalReference",
                   'amount', round(a.amount, 2)::text, 'status', a.status, 'network', a.network, 'createdAt', a."createdAt") order by a."createdAt" desc), '[]')
                 from (select * from "PaymentAttempt" where "orderId" = o.id order by "createdAt" desc limit 5) a));
end $$;

-- POST /payments/initiate
create or replace function app.initiate_payment(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare o "Order"; amt numeric; v_ref text; a "PaymentAttempt"; v_net text := b->>'network'; v_phone text := b->>'momoPhone';
begin
  if app.blank(b->>'orderId') then perform app.err(400, 'orderId required'); end if;
  if v_net is null or v_net not in (select unnest(enum_range(null::"PaymentNetwork"))::text) then perform app.err(400, 'Invalid network'); end if;
  if v_phone is null or length(v_phone) < 9 then perform app.err(400, 'Mobile Money number required'); end if;
  select * into o from "Order" where id = b->>'orderId' for update;
  if not found or o."businessId" <> me.business_id then perform app.err(404, 'Order not found'); end if;
  if o."agreedTotal" is null or o.status::text not in ('AGREED','DELIVERED','COMPLETED') then
    perform app.err(400, 'Order is not ready for payment');
  end if;
  if o."isPaid" then perform app.err(400, 'Order is already fully paid'); end if;
  amt := round(app.num(b->'amount'), 2);
  if amt is null or amt <= 0 then perform app.err(400, 'Amount must be positive'); end if;
  if amt > o."outstandingBalance" then perform app.err(400, 'Amount exceeds outstanding balance'); end if;
  if btrim(v_phone) = '' then perform app.err(400, 'Mobile Money number required'); end if;

  v_ref := 'OPPAY-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 16));
  insert into "PaymentAttempt" ("businessId","orderId","internalReference","network","momoPhone","amount","status")
  values (o."businessId", o.id, v_ref, v_net::"PaymentNetwork", regexp_replace(v_phone, '\s+', '', 'g'), amt, 'PENDING')
  returning * into a;
  perform app.audit(o."businessId", me.id, 'PaymentAttempt', a.id, 'INITIATE',
    jsonb_build_object('amount', amt::text, 'network', v_net, 'internalReference', v_ref));
  return jsonb_build_object('attemptId', a.id, 'internalReference', a."internalReference", 'amount', round(a.amount, 2)::text,
    'status', a.status, 'network', a.network, 'momoPhone', a."momoPhone", 'orderId', o.id, 'orderNumber', o."orderNumber");
end $$;

-- Simulated provider success (the old webhook SUCCESS branch).
create or replace function app.process_success(p_ref text, p_provider_ref text) returns jsonb language plpgsql as $$
declare a "PaymentAttempt"; o "Order"; c "Customer"; p "Payment"; rcpt text; paid numeric; outst numeric; v_paid boolean;
begin
  select * into a from "PaymentAttempt" where "internalReference" = p_ref for update;
  if not found then perform app.err(404, 'Payment attempt not found'); end if;
  select * into p from "Payment" where "attemptId" = a.id;
  if found then
    return jsonb_build_object('idempotent', true, 'id', p.id, 'paymentId', p.id, 'attemptId', a.id, 'status', 'SUCCESS',
      'message', 'Webhook already processed', 'receiptNumber', p."receiptNumber", 'amount', round(p.amount, 2)::text);
  end if;
  select * into p from "Payment" where "providerReference" = p_provider_ref;
  if found then
    return jsonb_build_object('idempotent', true, 'id', p.id, 'paymentId', p.id, 'attemptId', a.id, 'status', 'SUCCESS',
      'message', 'Provider reference already recorded');
  end if;

  select * into o from "Order" where id = a."orderId" for update;
  if o."agreedTotal" is null or o.status::text not in ('AGREED','DELIVERED','COMPLETED') then perform app.err(400, 'Order not payable'); end if;
  if round(a.amount, 2) > o."outstandingBalance" then perform app.err(400, 'Payment exceeds outstanding balance at verification time'); end if;

  rcpt := 'RCPT-' || to_char(app.now_utc(), 'YYYYMMDD') || '-' || upper(left(gen_random_uuid()::text, 8));
  update "PaymentAttempt" set status = 'SUCCESS', "providerReference" = p_provider_ref, "receiptNumber" = rcpt,
         "completedAt" = app.now_utc(),
         "webhookPayload" = jsonb_build_object('internalReference', p_ref, 'status', 'SUCCESS', 'providerReference', p_provider_ref)
   where id = a.id;
  insert into "Payment" ("businessId","orderId","attemptId","providerReference","network","momoPhone","amount","receiptNumber")
  values (a."businessId", a."orderId", a.id, p_provider_ref, a.network, a."momoPhone", round(a.amount, 2), rcpt)
  returning * into p;
  insert into "PaymentAllocation" ("paymentId","orderId","amount") values (p.id, a."orderId", p.amount);

  paid := round(o."amountPaid" + p.amount, 2);
  outst := round(o."agreedTotal" - paid, 2);
  v_paid := outst <= 0;
  update "Order" set "amountPaid" = paid, "outstandingBalance" = greatest(outst, 0), "isPaid" = v_paid,
         status = case when v_paid and o.status = 'DELIVERED' then 'COMPLETED'::"OrderStatus" else status end,
         "completedAt" = case when v_paid and o.status = 'DELIVERED' then app.now_utc() else "completedAt" end
   where id = o.id;

  perform app.audit(a."businessId", null, 'Payment', p.id, 'VERIFIED',
    jsonb_build_object('amount', round(p.amount, 2)::text, 'providerReference', p_provider_ref, 'internalReference', p_ref));
  select * into c from "Customer" where id = o."customerId";
  perform app.notify(a."businessId", c.phone, 'PAYMENT_SUCCESS',
    format('OrderBook: Payment of %s received for %s. Receipt %s.', app.ghs(p.amount), o."orderNumber", rcpt),
    o.id, p.id, '/customer/receipts/' || p.id);

  return jsonb_build_object('idempotent', false, 'id', p.id, 'paymentId', p.id, 'attemptId', a.id, 'status', 'SUCCESS',
    'receiptNumber', rcpt, 'amount', round(p.amount, 2)::text);
end $$;

-- POST /payments/checkout
create or replace function app.checkout(me app.ctx, b jsonb) returns jsonb language plpgsql as $$
declare att jsonb;
begin
  perform app.need_role(me, 'CUSTOMER');
  perform app.payment_page(me, b->>'orderId');
  att := app.initiate_payment(me, b);
  return app.process_success(att->>'internalReference', 'SIM-' || (att->>'internalReference'));
end $$;

-- GET /payments
create or replace function app.list_payments(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'SELLER');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'orderId', p."orderId", 'orderNumber', o."orderNumber",
            'amount', round(p.amount, 2)::text, 'network', p.network, 'momoPhone', p."momoPhone", 'receiptNumber', p."receiptNumber",
            'providerReference', p."providerReference", 'paidAt', p."paidAt") order by p."paidAt" desc), '[]')
          from (select * from "Payment" where "businessId" = me.business_id order by "paidAt" desc limit 100) p
          join "Order" o on o.id = p."orderId");
end $$;

-- GET /payments/attempts
create or replace function app.list_attempts(me app.ctx, q jsonb) returns jsonb language plpgsql stable as $$
declare v_status text := nullif(q->>'status', '');
begin
  perform app.need_role(me, 'SELLER');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'orderId', a."orderId", 'orderNumber', o."orderNumber",
            'internalReference', a."internalReference", 'providerReference', a."providerReference", 'amount', round(a.amount, 2)::text,
            'status', a.status, 'network', a.network, 'momoPhone', a."momoPhone", 'receiptNumber', a."receiptNumber",
            'createdAt', a."createdAt", 'completedAt', a."completedAt",
            'hasPayment', exists (select 1 from "Payment" p where p."attemptId" = a.id)) order by a."createdAt" desc), '[]')
          from (select * from "PaymentAttempt" where "businessId" = me.business_id
                  and (v_status is null or status::text = v_status) order by "createdAt" desc limit 100) a
          join "Order" o on o.id = a."orderId");
end $$;

-- GET /payments/receipts/:id
create or replace function app.get_receipt(me app.ctx, p_id text) returns jsonb language plpgsql stable as $$
declare p "Payment"; o "Order"; c "Customer"; bz "Business"; a "PaymentAttempt"; rev_id text;
begin
  select * into p from "Payment" where id = p_id and "businessId" = me.business_id;
  if not found then perform app.err(404, 'Receipt not found'); end if;
  select * into o from "Order" where id = p."orderId";
  if me.role = 'CUSTOMER' and o."customerId" is distinct from me.customer_id then perform app.err(404, 'Receipt not found'); end if;
  select * into c from "Customer" where id = o."customerId";
  select * into bz from "Business" where id = o."businessId";
  select * into a from "PaymentAttempt" where id = p."attemptId";
  select id into rev_id from "OrderRevision" where "orderId" = o.id and "isLocked" order by "revisionNumber" desc limit 1;
  return jsonb_build_object(
    'receiptNumber', p."receiptNumber", 'paidAt', p."paidAt", 'amount', round(p.amount, 2)::text, 'network', p.network,
    'momoPhone', p."momoPhone", 'providerReference', p."providerReference", 'internalReference', a."internalReference",
    'businessName', bz.name, 'customerName', c.name, 'customerPhone', c.phone, 'orderNumber', o."orderNumber", 'orderId', o.id,
    'orderAgreedTotal', case when o."agreedTotal" is null then null else round(o."agreedTotal", 2)::text end,
    'orderAmountPaid', round(o."amountPaid", 2)::text, 'orderOutstanding', round(o."outstandingBalance", 2)::text,
    'isOrderPaid', o."isPaid",
    'items', case when rev_id is null then null else (select coalesce(jsonb_agg(jsonb_build_object(
        'name', i."productNameSnapshot", 'variant', i."variantNameSnapshot", 'quantity', i."actualQuantity"::text,
        'unit', i."unitSnapshot", 'unitPrice', round(i."confirmedUnitPrice", 2)::text, 'lineTotal', round(i."actualLineTotal", 2)::text)
        order by i."sortOrder"), '[]') from "OrderRevisionItem" i where i."revisionId" = rev_id and not i."isRemoved") end);
end $$;

-- GET /payments/history/me
create or replace function app.payment_history(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'CUSTOMER');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'orderId', p."orderId", 'orderNumber', o."orderNumber",
            'amount', round(p.amount, 2)::text, 'network', p.network, 'receiptNumber', p."receiptNumber", 'paidAt', p."paidAt")
            order by p."paidAt" desc), '[]')
          from "Payment" p join "Order" o on o.id = p."orderId"
          where p."businessId" = me.business_id and o."customerId" = me.customer_id);
end $$;
