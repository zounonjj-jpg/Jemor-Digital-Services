-- SAVOIR+ role-first registration, seller stores, automatic publishing and protected admin directory.
-- Apply once to the SEM Supabase project. Existing live changes are already applied.

alter table public.profiles
  add column if not exists learner_kind text not null default 'school_student'
    check (learner_kind in ('school_student','university_student')),
  add column if not exists birth_year smallint
    check (birth_year is null or birth_year between 1900 and extract(year from now())::int),
  add column if not exists school_class text not null default '',
  add column if not exists university_year text not null default '',
  add column if not exists study_field text not null default '',
  add column if not exists child_class text not null default '',
  add column if not exists signup_goal text not null default '';

alter table public.teacher_profiles
  add column if not exists store_name text not null default '',
  add column if not exists store_description text not null default '',
  add column if not exists store_slug text,
  add column if not exists all_subjects boolean not null default false,
  add column if not exists all_levels boolean not null default false;

create unique index if not exists teacher_profiles_store_slug_unique
  on public.teacher_profiles (lower(store_slug))
  where store_slug is not null and store_slug <> '';

create or replace function private.enforce_listing_auto_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_savoir_admin() then new.status := 'approved'; end if;
  elsif tg_op = 'UPDATE' then
    if not public.is_savoir_admin() then new.status := old.status; end if;
  end if;
  return new;
end; $$;

drop trigger if exists listings_auto_publish on public.listings;
create trigger listings_auto_publish
before insert or update of status on public.listings
for each row execute function private.enforce_listing_auto_publication();

drop policy if exists "Admins can create their own listings" on public.listings;
drop policy if exists "Only teachers can submit listings" on public.listings;
create policy "Teachers and admins can submit listings"
on public.listings for insert to authenticated
with check (
  seller_id=(select auth.uid())
  and (public.is_savoir_admin() or exists(
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.account_type='teacher'
  ))
);

create table if not exists private.user_directory (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  account_type text not null default 'student',
  app_role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.user_directory enable row level security;
drop policy if exists "Admins can read user directory" on private.user_directory;
create policy "Admins can read user directory" on private.user_directory
for select to authenticated using (public.is_savoir_admin());
grant usage on schema private to authenticated;
grant select on private.user_directory to authenticated;

create or replace function private.sync_user_directory()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.user_directory(user_id,email,account_type,app_role,created_at,updated_at)
  values(new.id,coalesce(new.email,''),
         case when new.raw_user_meta_data->>'account_type' in ('student','parent','teacher') then new.raw_user_meta_data->>'account_type' else 'student' end,
         coalesce(new.raw_app_meta_data->>'role','user'),coalesce(new.created_at,now()),now())
  on conflict(user_id) do update set email=excluded.email,account_type=excluded.account_type,
    app_role=excluded.app_role,updated_at=now();
  return new;
end; $$;
revoke all on function private.sync_user_directory() from public,anon,authenticated;
drop trigger if exists sync_savoir_user_directory on auth.users;
create trigger sync_savoir_user_directory after insert or update of email,raw_user_meta_data,raw_app_meta_data on auth.users
for each row execute function private.sync_user_directory();

insert into private.user_directory(user_id,email,account_type,app_role,created_at,updated_at)
select id,coalesce(email,''),coalesce(raw_user_meta_data->>'account_type','student'),
       coalesce(raw_app_meta_data->>'role','user'),created_at,now()
from auth.users
on conflict(user_id) do update set email=excluded.email,account_type=excluded.account_type,
app_role=excluded.app_role,updated_at=now();

create or replace view public.admin_user_directory with (security_invoker=true) as
select d.user_id,d.email,d.account_type,d.app_role,d.created_at,p.display_name,p.country,p.city,p.phone,
       p.learner_kind,p.school_class,p.university_year,p.study_field,p.child_class,p.signup_goal,
       tp.store_name,tp.store_description,tp.subjects as teacher_subjects,tp.levels as teacher_levels
from private.user_directory d left join public.profiles p on p.id=d.user_id
left join public.teacher_profiles tp on tp.user_id=d.user_id;
grant select on public.admin_user_directory to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_account_type text; v_learner_kind text; v_birth_year smallint; v_subjects text[]; v_levels text[];
begin
  v_account_type := case when new.raw_user_meta_data->>'account_type' in ('student','parent','teacher')
    then new.raw_user_meta_data->>'account_type' else 'student' end;
  v_learner_kind := case when new.raw_user_meta_data->>'learner_kind' in ('school_student','university_student')
    then new.raw_user_meta_data->>'learner_kind' else 'school_student' end;
  v_birth_year := case when coalesce(new.raw_user_meta_data->>'birth_year','') ~ '^\\d{4}$'
    then (new.raw_user_meta_data->>'birth_year')::smallint else null end;
  select coalesce(array_agg(trim(x)), '{}'::text[]) into v_subjects
    from unnest(string_to_array(coalesce(new.raw_user_meta_data->>'teacher_subjects',''),',')) x where trim(x)<>'';
  select coalesce(array_agg(trim(x)), '{}'::text[]) into v_levels
    from unnest(string_to_array(coalesce(new.raw_user_meta_data->>'teacher_levels',''),',')) x where trim(x)<>'';
  insert into public.profiles(id,display_name,account_type,country,city,phone,learner_kind,birth_year,school_class,university_year,study_field,child_class,signup_goal)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),
    v_account_type,coalesce(nullif(trim(new.raw_user_meta_data->>'country'),''),'Non précisé'),
    coalesce(new.raw_user_meta_data->>'city',''),coalesce(new.raw_user_meta_data->>'phone',''),v_learner_kind,v_birth_year,
    coalesce(new.raw_user_meta_data->>'school_class',''),coalesce(new.raw_user_meta_data->>'university_year',''),
    coalesce(new.raw_user_meta_data->>'study_field',''),coalesce(new.raw_user_meta_data->>'child_class',''),
    coalesce(new.raw_user_meta_data->>'signup_goal',''))
  on conflict(id) do update set display_name=excluded.display_name,account_type=excluded.account_type,country=excluded.country,
    city=excluded.city,phone=excluded.phone,learner_kind=excluded.learner_kind,birth_year=excluded.birth_year,
    school_class=excluded.school_class,university_year=excluded.university_year,study_field=excluded.study_field,
    child_class=excluded.child_class,signup_goal=excluded.signup_goal,updated_at=now();
  if v_account_type='teacher' then
    insert into public.teacher_profiles(user_id,headline,subjects,levels,store_name,store_description,all_subjects,all_levels)
    values(new.id,coalesce(new.raw_user_meta_data->>'teacher_headline',''),v_subjects,v_levels,
      coalesce(new.raw_user_meta_data->>'store_name',''),coalesce(new.raw_user_meta_data->>'store_description',''),
      coalesce((new.raw_user_meta_data->>'all_subjects')::boolean,false),
      coalesce((new.raw_user_meta_data->>'all_levels')::boolean,false))
    on conflict(user_id) do update set headline=excluded.headline,subjects=excluded.subjects,levels=excluded.levels,
      store_name=excluded.store_name,store_description=excluded.store_description,
      all_subjects=excluded.all_subjects,all_levels=excluded.all_levels,updated_at=now();
  end if;
  return new;
end; $$;

create or replace function private.promote_savoir_admin(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if coalesce((select auth.jwt()->'app_metadata'->>'is_platform_owner')='true',false) is not true then
    raise exception 'Only the platform owner can appoint administrators';
  end if;
  if p_user_id is null or p_user_id=(select auth.uid()) then raise exception 'Choose another user account'; end if;
  select email into v_email from auth.users where id=p_user_id for update;
  if v_email is null then raise exception 'User account not found'; end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('role','savoir_admin')
    where id=p_user_id;
  insert into public.admin_actions(admin_id,action,target_type,target_id,details)
  values((select auth.uid()),'administrator_appointed','user',p_user_id,jsonb_build_object('email',v_email,'role','savoir_admin'));
end; $$;

create or replace function public.promote_savoir_admin(p_user_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.promote_savoir_admin(p_user_id); $$;
grant usage on schema private to authenticated;
revoke all on function private.promote_savoir_admin(uuid) from public,anon;
grant execute on function private.promote_savoir_admin(uuid) to authenticated;
revoke all on function public.promote_savoir_admin(uuid) from public,anon;
grant execute on function public.promote_savoir_admin(uuid) to authenticated;

create or replace function private.get_teacher_customers()
returns table(order_id uuid,buyer_id uuid,buyer_name text,buyer_email text,listing_id uuid,listing_title text,amount_xof integer,purchased_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  return query
  select o.id,o.buyer_id,coalesce(p.display_name,'Client SAVOIR+'),u.email,oi.listing_id,oi.title_snapshot,oi.unit_price_xof,o.created_at
  from public.order_items oi join public.orders o on o.id=oi.order_id
  join auth.users u on u.id=o.buyer_id left join public.profiles p on p.id=o.buyer_id
  where oi.seller_id=(select auth.uid()) and o.status='paid' order by o.created_at desc;
end; $$;
create or replace function public.get_teacher_customers()
returns table(order_id uuid,buyer_id uuid,buyer_name text,buyer_email text,listing_id uuid,listing_title text,amount_xof integer,purchased_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from private.get_teacher_customers(); $$;
revoke all on function private.get_teacher_customers() from public,anon;
grant execute on function private.get_teacher_customers() to authenticated;
revoke all on function public.get_teacher_customers() from public,anon;
grant execute on function public.get_teacher_customers() to authenticated;

-- The platform owner's app_metadata must contain is_platform_owner=true.
-- The initial owner flag was assigned to the verified SAVOIR+ owner account outside this repeatable migration.
