-- SAVOIR+ marketplace: multi-file products, shareable publication, commission ledger and payment core.
-- Applied to Supabase project SEM. Provider-specific checkout/webhook integration remains intentionally pending.

create or replace function private.enforce_savoir_product_file_limits()
returns trigger language plpgsql set search_path = '' as $$
declare v_pdf_count integer; v_video_count integer; v_owner uuid;
begin
  select seller_id into v_owner from public.listings where id=new.listing_id for update;
  if v_owner is null then raise exception 'Product not found'; end if;
  if v_owner <> auth.uid() and not public.is_savoir_admin() then raise exception 'You cannot add files to this product'; end if;
  if new.mime_type not in ('application/pdf','video/mp4') then raise exception 'Only PDF and MP4 files are accepted'; end if;
  if new.file_size_bytes <= 0 or new.file_size_bytes > 104857600 then raise exception 'Each file must be between 1 byte and 100 MB'; end if;
  if new.mime_type='application/pdf' then
    select count(*) into v_pdf_count from public.product_files where listing_id=new.listing_id and mime_type='application/pdf';
    if v_pdf_count>=20 then raise exception 'A product cannot contain more than 20 PDF files'; end if;
  elsif new.mime_type='video/mp4' then
    select count(*) into v_video_count from public.product_files where listing_id=new.listing_id and mime_type='video/mp4';
    if v_video_count>=10 then raise exception 'A product cannot contain more than 10 MP4 videos'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists product_files_enforce_limits on public.product_files;
create trigger product_files_enforce_limits before insert on public.product_files
for each row execute function private.enforce_savoir_product_file_limits();

create table if not exists public.platform_settings (
  setting_key text primary key,
  commission_percent numeric(5,2) not null check (commission_percent>=0 and commission_percent<=100),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings(setting_key,commission_percent)
values('marketplace_default',10.00)
on conflict(setting_key) do update set commission_percent=excluded.commission_percent,updated_at=now();
alter table public.platform_settings enable row level security;
drop policy if exists "Admins can read platform settings" on public.platform_settings;
create policy "Admins can read platform settings" on public.platform_settings
for select to authenticated using(public.is_savoir_admin());
revoke all on public.platform_settings from anon,authenticated;
grant select on public.platform_settings to authenticated;

create table if not exists public.platform_ledger (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.order_items(id) on delete restrict,
  amount_xof integer not null check(amount_xof>=0),
  entry_type text not null check(entry_type in ('sale_commission','adjustment','refund')),
  description text not null default '',
  created_at timestamptz not null default now()
);
alter table public.platform_ledger enable row level security;
drop policy if exists "Admins can read platform ledger" on public.platform_ledger;
create policy "Admins can read platform ledger" on public.platform_ledger
for select to authenticated using(public.is_savoir_admin());
revoke all on public.platform_ledger from anon,authenticated;
grant select on public.platform_ledger to authenticated;

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payment_id uuid references public.payments(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique(provider,event_id)
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from anon,authenticated;
create unique index if not exists payments_provider_reference_unique
on public.payments(provider,provider_reference) where provider_reference is not null;
create unique index if not exists wallet_sale_order_item_unique
on public.wallet_transactions(order_item_id)
where order_item_id is not null and transaction_type='sale';

create or replace function private.create_savoir_order(p_listing_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_buyer uuid:=auth.uid(); v_listing public.listings%rowtype; v_order uuid;
v_fee integer; v_teacher_amount integer; v_rate numeric(5,2);
begin
  if v_buyer is null then raise exception 'Authentication required'; end if;
  select * into v_listing from public.listings where id=p_listing_id and status='approved' for share;
  if not found then raise exception 'Published product not found'; end if;
  if v_listing.seller_id=v_buyer then raise exception 'You cannot buy your own product'; end if;
  if v_listing.price_xof<=0 then raise exception 'This product is free'; end if;
  select commission_percent into v_rate from public.platform_settings where setting_key='marketplace_default';
  v_rate:=coalesce(v_rate,10.00);
  v_fee:=round(v_listing.price_xof*v_rate/100.0)::integer;
  v_teacher_amount:=v_listing.price_xof-v_fee;
  insert into public.orders(buyer_id,currency,subtotal_xof,status)
  values(v_buyer,'XOF',v_listing.price_xof,'pending') returning id into v_order;
  insert into public.order_items(order_id,listing_id,seller_id,title_snapshot,unit_price_xof,platform_fee_xof,teacher_amount_xof)
  values(v_order,v_listing.id,v_listing.seller_id,v_listing.title,v_listing.price_xof,v_fee,v_teacher_amount);
  return v_order;
end; $$;
create or replace function public.create_savoir_order(p_listing_id uuid)
returns uuid language sql security definer set search_path = '' as $
select private.create_savoir_order(p_listing_id); $$;
revoke all on function public.create_savoir_order(uuid) from public,anon;
grant execute on function public.create_savoir_order(uuid) to authenticated;

create or replace function public.create_savoir_payment_attempt(p_order_id uuid,p_provider text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_payment uuid; v_buyer uuid; v_amount integer;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payment service required'; end if;
  if p_provider is null or length(trim(p_provider))=0 or p_provider='unconfigured' then raise exception 'A real payment provider must be configured'; end if;
  select buyer_id,subtotal_xof into v_buyer,v_amount from public.orders where id=p_order_id and status='pending' for update;
  if v_buyer is null then raise exception 'Pending order not found'; end if;
  insert into public.payments(order_id,buyer_id,provider,amount_xof,status)
  values(p_order_id,v_buyer,p_provider,v_amount,'pending') returning id into v_payment;
  return v_payment;
end; $$;
revoke all on function public.create_savoir_payment_attempt(uuid,text) from public,anon,authenticated;
grant execute on function public.create_savoir_payment_attempt(uuid,text) to service_role;

create or replace function public.confirm_savoir_payment(
  p_payment_id uuid,p_provider_reference text,p_event_id text,p_amount_xof integer,p_event_payload jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments%rowtype; v_order public.orders%rowtype; v_inserted integer;
begin
  if auth.role()<>'service_role' then raise exception 'Trusted payment service required'; end if;
  if coalesce(trim(p_event_id),'')='' or coalesce(trim(p_provider_reference),'')='' then raise exception 'Provider event and reference are required'; end if;
  select * into v_payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment attempt not found'; end if;
  if v_payment.status='succeeded' then return true; end if;
  if v_payment.status<>'pending' then raise exception 'Payment is not pending'; end if;
  if v_payment.amount_xof<>p_amount_xof then raise exception 'Payment amount mismatch'; end if;
  insert into public.payment_webhook_events(provider,event_id,payment_id,payload)
  values(v_payment.provider,p_event_id,v_payment.id,coalesce(p_event_payload,'{}'::jsonb))
  on conflict(provider,event_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then return true; end if;
  select * into v_order from public.orders where id=v_payment.order_id for update;
  if not found or v_order.status<>'pending' then raise exception 'Order is not pending'; end if;
  if v_order.subtotal_xof<>p_amount_xof then raise exception 'Order amount mismatch'; end if;
  update public.payments set status='succeeded',provider_reference=p_provider_reference,
    provider_payload=coalesce(p_event_payload,'{}'::jsonb),updated_at=now() where id=p_payment_id;
  update public.orders set status='paid',updated_at=now() where id=v_order.id;
  insert into public.enrollments(learner_id,listing_id,source,status)
  select v_order.buyer_id,listing_id,'purchase','active' from public.order_items where order_id=v_order.id
  on conflict(learner_id,listing_id) do update set status='active';
  insert into public.wallet_transactions(teacher_id,order_item_id,transaction_type,amount_xof,description)
  select seller_id,id,'sale',teacher_amount_xof,'Vente confirmée — commande '||left(v_order.id::text,8)
  from public.order_items where order_id=v_order.id on conflict do nothing;
  insert into public.platform_ledger(order_item_id,amount_xof,entry_type,description)
  select id,platform_fee_xof,'sale_commission','Commission SAVOIR+ — commande '||left(v_order.id::text,8)
  from public.order_items where order_id=v_order.id on conflict(order_item_id) do nothing;
  insert into public.notifications(user_id,title,body,kind)
  values(v_order.buyer_id,'Paiement confirmé','Ton achat est confirmé. Le produit est disponible dans ta bibliothèque.','purchase_confirmed');
  insert into public.notifications(user_id,title,body,kind)
  select seller_id,'Nouvelle vente','Un produit vient d’être vendu. Ton revenu est crédité dans ton portefeuille.','sale'
  from public.order_items where order_id=v_order.id;
  return true;
end; $$;
revoke all on function public.confirm_savoir_payment(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_savoir_payment(uuid,text,text,integer,jsonb) to service_role;

create or replace function private.enforce_listing_auto_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if not public.is_savoir_admin() then new.status:='draft'; end if;
  elsif tg_op='UPDATE' then
    if not public.is_savoir_admin() and coalesce(current_setting('savoir.publish_listing',true),'0')<>'1' then new.status:=old.status; end if;
  end if;
  return new;
end; $$;
create or replace function public.publish_savoir_listing(p_listing_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_files integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select seller_id into v_owner from public.listings where id=p_listing_id for update;
  if v_owner is null then raise exception 'Product not found'; end if;
  if v_owner<>auth.uid() and not public.is_savoir_admin() then raise exception 'You cannot publish this product'; end if;
  select count(*) into v_files from public.product_files where listing_id=p_listing_id;
  if v_files<1 then raise exception 'Upload at least one product file before publishing'; end if;
  perform set_config('savoir.publish_listing','1',true);
  update public.listings set status='approved',updated_at=now() where id=p_listing_id;
  perform set_config('savoir.publish_listing','0',true);
end; $$;
revoke all on function public.publish_savoir_listing(uuid) from public,anon;
grant execute on function public.publish_savoir_listing(uuid) to authenticated;
