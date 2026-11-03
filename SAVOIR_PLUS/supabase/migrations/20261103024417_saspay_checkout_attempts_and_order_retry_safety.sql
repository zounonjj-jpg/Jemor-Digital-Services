alter table public.orders
  add column if not exists source_listing_id uuid references public.listings(id) on delete restrict;

update public.orders o
set source_listing_id = x.listing_id
from (
  select order_id, min(listing_id::text)::uuid as listing_id
  from public.order_items
  group by order_id
  having count(*) = 1
) x
where o.id = x.order_id and o.source_listing_id is null;

alter table public.payments drop constraint if exists payments_order_id_key;
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments
  add constraint payments_provider_check
  check (provider = any (array['unconfigured','fedapay','kkiapay','cinetpay','manual','saspay']::text[]));

create unique index if not exists orders_one_pending_per_buyer_listing
  on public.orders(buyer_id, source_listing_id)
  where status = 'pending' and source_listing_id is not null;

create unique index if not exists payments_one_pending_per_order
  on public.payments(order_id)
  where status = 'pending';

create or replace function private.create_savoir_order(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_order uuid;
  v_fee integer;
  v_teacher_amount integer;
  v_rate numeric(5,2);
begin
  if v_buyer is null then raise exception 'Authentication required'; end if;

  select * into v_listing
  from public.listings
  where id = p_listing_id and status = 'approved'
  for share;

  if not found then raise exception 'Published product not found'; end if;
  if v_listing.seller_id = v_buyer then raise exception 'You cannot buy your own product'; end if;
  if v_listing.price_xof <= 0 then raise exception 'This product is free'; end if;

  select id into v_order
  from public.orders
  where buyer_id = v_buyer
    and source_listing_id = p_listing_id
    and status = 'pending'
  for update;

  if v_order is not null then
    return v_order;
  end if;

  select commission_percent into v_rate
  from public.platform_settings
  where setting_key = 'marketplace_default';
  v_rate := coalesce(v_rate, 10.00);

  v_fee := round(v_listing.price_xof * v_rate / 100.0)::integer;
  v_teacher_amount := v_listing.price_xof - v_fee;

  begin
    insert into public.orders(buyer_id, currency, subtotal_xof, status, source_listing_id)
    values(v_buyer, 'XOF', v_listing.price_xof, 'pending', p_listing_id)
    returning id into v_order;

    insert into public.order_items(
      order_id, listing_id, seller_id, title_snapshot,
      unit_price_xof, platform_fee_xof, teacher_amount_xof
    )
    values(
      v_order, v_listing.id, v_listing.seller_id, v_listing.title,
      v_listing.price_xof, v_fee, v_teacher_amount
    );
  exception when unique_violation then
    select id into v_order
    from public.orders
    where buyer_id = v_buyer
      and source_listing_id = p_listing_id
      and status = 'pending';
    if v_order is null then raise; end if;
  end;

  return v_order;
end;
$$;

create or replace function public.create_savoir_order(p_listing_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$ select private.create_savoir_order(p_listing_id); $$;

revoke all on function public.create_savoir_order(uuid) from public, anon;
grant execute on function public.create_savoir_order(uuid) to authenticated;

create or replace function public.claim_savoir_payment_attempt(p_order_id uuid)
returns table(payment_id uuid, claimed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payment uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted payment service required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0));

  select * into v_order
  from public.orders
  where id = p_order_id and status = 'pending'
  for update;

  if not found then raise exception 'Pending order not found'; end if;

  select id into v_payment
  from public.payments
  where order_id = p_order_id and status = 'pending'
  for update;

  if v_payment is not null then
    return query select v_payment, false;
    return;
  end if;

  insert into public.payments(
    order_id, buyer_id, provider, amount_xof, status, provider_payload
  )
  values(
    p_order_id, v_order.buyer_id, 'saspay', v_order.subtotal_xof, 'pending',
    jsonb_build_object('saspay', jsonb_build_object('initiation_status', 'starting'))
  )
  returning id into v_payment;

  return query select v_payment, true;
end;
$$;

revoke all on function public.claim_savoir_payment_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_savoir_payment_attempt(uuid) to service_role;

create or replace function public.confirm_savoir_payment(
  p_payment_id uuid,
  p_provider_reference text,
  p_event_id text,
  p_amount_xof integer,
  p_event_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_inserted integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Trusted payment service required'; end if;
  if coalesce(trim(p_event_id), '') = '' or coalesce(trim(p_provider_reference), '') = '' then
    raise exception 'Provider event and reference are required';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'Payment attempt not found'; end if;
  if v_payment.provider <> 'saspay' then raise exception 'Unexpected payment provider'; end if;
  if v_payment.status = 'succeeded' then return true; end if;
  if v_payment.status <> 'pending' then raise exception 'Payment is not pending'; end if;
  if v_payment.amount_xof <> p_amount_xof then raise exception 'Payment amount mismatch'; end if;

  insert into public.payment_webhook_events(provider, event_id, payment_id, payload)
  values('saspay', p_event_id, v_payment.id, coalesce(p_event_payload, '{}'::jsonb))
  on conflict(provider, event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return true; end if;

  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found or v_order.status <> 'pending' then raise exception 'Order is not pending'; end if;
  if v_order.subtotal_xof <> p_amount_xof then raise exception 'Order amount mismatch'; end if;

  update public.payments
  set status = 'succeeded',
      provider_reference = p_provider_reference,
      provider_payload = coalesce(provider_payload, '{}'::jsonb) || coalesce(p_event_payload, '{}'::jsonb),
      updated_at = now()
  where id = p_payment_id;

  update public.orders set status = 'paid', updated_at = now() where id = v_order.id;

  insert into public.enrollments(learner_id, listing_id, source, status)
  select v_order.buyer_id, listing_id, 'purchase', 'active'
  from public.order_items where order_id = v_order.id
  on conflict(learner_id, listing_id) do update set status = 'active';

  insert into public.wallet_transactions(teacher_id, order_item_id, transaction_type, amount_xof, description)
  select seller_id, id, 'sale', teacher_amount_xof,
         'Vente confirmée — commande ' || left(v_order.id::text, 8)
  from public.order_items where order_id = v_order.id
  on conflict do nothing;

  insert into public.platform_ledger(order_item_id, amount_xof, entry_type, description)
  select id, platform_fee_xof, 'sale_commission',
         'Commission SAVOIR+ — commande ' || left(v_order.id::text, 8)
  from public.order_items where order_id = v_order.id
  on conflict(order_item_id) do nothing;

  insert into public.notifications(user_id, title, body, kind)
  values(v_order.buyer_id, 'Paiement confirmé', 'Ton achat est confirmé. Le produit est disponible dans ta bibliothèque.', 'purchase_confirmed');

  insert into public.notifications(user_id, title, body, kind)
  select seller_id, 'Nouvelle vente', 'Un produit vient d’être vendu. Ton revenu est crédité dans ton portefeuille.', 'sale'
  from public.order_items where order_id = v_order.id;

  return true;
end;
$$;
revoke all on function public.confirm_savoir_payment(uuid, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_savoir_payment(uuid, text, text, integer, jsonb) to service_role;
