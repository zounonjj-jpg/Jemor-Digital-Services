create or replace function public.create_savoir_order(p_listing_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_savoir_order(p_listing_id);
$$;
revoke all on function public.create_savoir_order(uuid) from public, anon;
grant execute on function private.create_savoir_order(uuid) to authenticated;
grant execute on function public.create_savoir_order(uuid) to authenticated;

create or replace function private.publish_savoir_listing_impl(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_files integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select seller_id into v_owner from public.listings where id=p_listing_id for update;
  if v_owner is null then raise exception 'Product not found'; end if;
  if v_owner<>auth.uid() and not public.is_savoir_admin() then
    raise exception 'You cannot publish this product';
  end if;
  select count(*) into v_files from public.product_files where listing_id=p_listing_id;
  if v_files<1 then raise exception 'Upload at least one product file before publishing'; end if;
  perform set_config('savoir.publish_listing','1',true);
  update public.listings set status='approved',updated_at=now() where id=p_listing_id;
  perform set_config('savoir.publish_listing','0',true);
end;
$$;
revoke all on function private.publish_savoir_listing_impl(uuid) from public, anon;
grant execute on function private.publish_savoir_listing_impl(uuid) to authenticated;

create or replace function public.publish_savoir_listing(p_listing_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.publish_savoir_listing_impl(p_listing_id);
$$;
revoke all on function public.publish_savoir_listing(uuid) from public, anon;
grant execute on function public.publish_savoir_listing(uuid) to authenticated;

drop policy if exists payment_webhook_events_service_role_only on public.payment_webhook_events;
create policy payment_webhook_events_service_role_only
on public.payment_webhook_events
for all to service_role
using (true)
with check (true);
revoke all on public.payment_webhook_events from anon, authenticated;
