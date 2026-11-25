-- OrderBook — customer home: counts of unpaid / completed / all orders, and the list of unpaid orders.
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
    'summary', (select jsonb_build_object(
        'totalOrders', count(*) filter (where status not in ('DRAFT', 'CANCELLED')),
        'activeCount', count(*) filter (where status in ('SUBMITTED','PREPARING','AWAITING_CUSTOMER_APPROVAL','CHANGE_REQUESTED','AGREED','READY_FOR_DELIVERY','DISPATCHED')),
        'completedCount', count(*) filter (where status in ('DELIVERED', 'COMPLETED')),
        'unpaidCount', count(*) filter (where status not in ('DRAFT', 'CANCELLED') and "outstandingBalance" > 0),
        'unpaidTotal', round(coalesce(sum("outstandingBalance") filter (where status not in ('DRAFT', 'CANCELLED')), 0), 2)::text)
      from "Order" where "customerId" = cust.id and "businessId" = me.business_id),
    'unpaidOrders', (select coalesce(jsonb_agg(app.j_order(o) order by o."createdAt"), '[]')
                       from (select * from "Order" where "customerId" = cust.id and "businessId" = me.business_id
                               and status not in ('DRAFT', 'CANCELLED') and "outstandingBalance" > 0
                             order by "createdAt" limit 20) o),
    'recentOrders', (select coalesce(jsonb_agg(app.j_order(o) || jsonb_build_object('revisions', app.j_latest_rev(o.id, false)) order by o."createdAt" desc), '[]')
                       from (select * from "Order" where "customerId" = cust.id and "businessId" = me.business_id
                             order by "createdAt" desc limit 8) o));
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
