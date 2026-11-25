-- OrderBook — seller draft baskets (one per seller + customer), synced across devices.
create table if not exists "SellerDraft" (
  "id" text primary key default gen_random_uuid()::text,
  "businessId" text not null references "Business"(id),
  "sellerId" text not null references "User"(id) on delete cascade,
  "customerId" text not null references "Customer"(id) on delete cascade,
  "data" jsonb not null default '{}',
  "updatedAt" timestamp(3) not null default (now() at time zone 'utc'),
  unique ("sellerId", "customerId")
);
alter table "SellerDraft" enable row level security;
revoke all on "SellerDraft" from anon, authenticated;

-- GET /drafts → { [customerId]: { cart, deliveryInstructions, deliveryCharge, updatedAt (ms) } }
create or replace function app.list_drafts(me app.ctx) returns jsonb language plpgsql stable as $$
begin
  perform app.need_role(me, 'SELLER');
  return (select coalesce(jsonb_object_agg(d."customerId", d.data || jsonb_build_object(
            'updatedAt', (extract(epoch from d."updatedAt") * 1000)::bigint)), '{}')
          from "SellerDraft" d where d."sellerId" = me.id and d."businessId" = me.business_id);
end $$;

-- PUT /drafts/:customerId { cart, deliveryInstructions, deliveryCharge } — an empty basket deletes the draft.
create or replace function app.save_draft(me app.ctx, p_customer text, b jsonb) returns jsonb language plpgsql as $$
declare v_data jsonb;
begin
  perform app.need_role(me, 'SELLER');
  if not exists (select 1 from "Customer" where id = p_customer and "businessId" = me.business_id) then
    perform app.err(404, 'Customer not found');
  end if;
  if jsonb_typeof(b->'cart') is distinct from 'array' then perform app.err(400, 'cart must be a list'); end if;
  if jsonb_array_length(b->'cart') > 200 then perform app.err(400, 'Too many items in one request'); end if;
  v_data := jsonb_build_object('cart', b->'cart',
    'deliveryInstructions', coalesce(b->>'deliveryInstructions', ''),
    'deliveryCharge', coalesce(b->>'deliveryCharge', '0'));
  if octet_length(v_data::text) > 200000 then perform app.err(400, 'Draft is too large'); end if;

  if jsonb_array_length(b->'cart') = 0 and coalesce(b->>'deliveryInstructions', '') = '' then
    delete from "SellerDraft" where "sellerId" = me.id and "customerId" = p_customer;
    return jsonb_build_object('deleted', true);
  end if;
  insert into "SellerDraft" ("businessId", "sellerId", "customerId", data)
  values (me.business_id, me.id, p_customer, v_data)
  on conflict ("sellerId", "customerId") do update set data = excluded.data, "updatedAt" = (now() at time zone 'utc');
  return jsonb_build_object('saved', true);
end $$;

-- DELETE /drafts/:customerId
create or replace function app.delete_draft(me app.ctx, p_customer text) returns jsonb language plpgsql as $$
begin
  perform app.need_role(me, 'SELLER');
  delete from "SellerDraft" where "sellerId" = me.id and "customerId" = p_customer;
  return jsonb_build_object('deleted', true);
end $$;

revoke execute on all functions in schema app from public, anon, authenticated;
