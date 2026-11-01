-- Protect learner and parent personal details from the publicly readable profiles table.
-- Run after 20261101_role_first_marketplace.sql.

create table if not exists private.profile_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null default '',
  city text not null default '',
  learner_kind text not null default 'school_student'
    check (learner_kind in ('school_student','university_student')),
  birth_year smallint
    check (birth_year is null or birth_year between 1900 and extract(year from now())::int),
  school_class text not null default '',
  university_year text not null default '',
  study_field text not null default '',
  child_class text not null default '',
  signup_goal text not null default '',
  updated_at timestamptz not null default now()
);
alter table private.profile_details enable row level security;
drop policy if exists "Users and admins can read profile details" on private.profile_details;
create policy "Users and admins can read profile details" on private.profile_details
  for select to authenticated
  using (user_id=(select auth.uid()) or public.is_savoir_admin());
grant usage on schema private to authenticated;
grant select on private.profile_details to authenticated;

create or replace view public.profile_details with (security_invoker=true) as
select user_id,phone,city,learner_kind,birth_year,school_class,university_year,
       study_field,child_class,signup_goal,updated_at
from private.profile_details;
grant select on public.profile_details to authenticated;

insert into private.profile_details(user_id,phone,city,learner_kind,birth_year,school_class,
  university_year,study_field,child_class,signup_goal,updated_at)
select id,coalesce(phone,''),coalesce(city,''),coalesce(learner_kind,'school_student'),birth_year,
  coalesce(school_class,''),coalesce(university_year,''),coalesce(study_field,''),
  coalesce(child_class,''),coalesce(signup_goal,''),now()
from public.profiles
on conflict(user_id) do update set phone=excluded.phone,city=excluded.city,
  learner_kind=excluded.learner_kind,birth_year=excluded.birth_year,
  school_class=excluded.school_class,university_year=excluded.university_year,
  study_field=excluded.study_field,child_class=excluded.child_class,
  signup_goal=excluded.signup_goal,updated_at=now();

drop view if exists public.admin_user_directory;
create view public.admin_user_directory with (security_invoker=true) as
select d.user_id,d.email,d.account_type,d.app_role,d.created_at,p.display_name,p.country,
  x.city,x.phone,x.learner_kind,x.birth_year,x.school_class,x.university_year,
  x.study_field,x.child_class,x.signup_goal,tp.store_name,tp.store_description,
  tp.subjects as teacher_subjects,tp.levels as teacher_levels
from private.user_directory d
left join public.profiles p on p.id=d.user_id
left join private.profile_details x on x.user_id=d.user_id
left join public.teacher_profiles tp on tp.user_id=d.user_id;
grant select on public.admin_user_directory to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_account_type text;
  v_learner_kind text;
  v_birth_year smallint;
  v_subjects text[];
  v_levels text[];
begin
  v_account_type := case when new.raw_user_meta_data->>'account_type' in ('student','parent','teacher')
    then new.raw_user_meta_data->>'account_type' else 'student' end;
  v_learner_kind := case when new.raw_user_meta_data->>'learner_kind' in ('school_student','university_student')
    then new.raw_user_meta_data->>'learner_kind' else 'school_student' end;
  v_birth_year := case when coalesce(new.raw_user_meta_data->>'birth_year','') ~ '^\\d{4}$'
    then (new.raw_user_meta_data->>'birth_year')::smallint else null end;
  select coalesce(array_agg(trim(x)), '{}'::text[]) into v_subjects
    from unnest(string_to_array(coalesce(new.raw_user_meta_data->>'teacher_subjects',''),',')) x
    where trim(x)<>'';
  select coalesce(array_agg(trim(x)), '{}'::text[]) into v_levels
    from unnest(string_to_array(coalesce(new.raw_user_meta_data->>'teacher_levels',''),',')) x
    where trim(x)<>'';
  insert into public.profiles(id,display_name,account_type,country)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),
    v_account_type,coalesce(nullif(trim(new.raw_user_meta_data->>'country'),''),'Non précisé'))
  on conflict(id) do update set display_name=excluded.display_name,
    account_type=excluded.account_type,country=excluded.country,updated_at=now();
  insert into private.profile_details(user_id,phone,city,learner_kind,birth_year,school_class,
    university_year,study_field,child_class,signup_goal,updated_at)
  values(new.id,coalesce(new.raw_user_meta_data->>'phone',''),coalesce(new.raw_user_meta_data->>'city',''),
    v_learner_kind,v_birth_year,coalesce(new.raw_user_meta_data->>'school_class',''),
    coalesce(new.raw_user_meta_data->>'university_year',''),coalesce(new.raw_user_meta_data->>'study_field',''),
    coalesce(new.raw_user_meta_data->>'child_class',''),coalesce(new.raw_user_meta_data->>'signup_goal',''),now())
  on conflict(user_id) do update set phone=excluded.phone,city=excluded.city,
    learner_kind=excluded.learner_kind,birth_year=excluded.birth_year,
    school_class=excluded.school_class,university_year=excluded.university_year,
    study_field=excluded.study_field,child_class=excluded.child_class,
    signup_goal=excluded.signup_goal,updated_at=now();
  if v_account_type='teacher' then
    insert into public.teacher_profiles(user_id,headline,subjects,levels,store_name,
      store_description,all_subjects,all_levels)
    values(new.id,coalesce(new.raw_user_meta_data->>'teacher_headline',''),v_subjects,v_levels,
      coalesce(new.raw_user_meta_data->>'store_name',''),
      coalesce(new.raw_user_meta_data->>'store_description',''),
      coalesce((new.raw_user_meta_data->>'all_subjects')::boolean,false),
      coalesce((new.raw_user_meta_data->>'all_levels')::boolean,false))
    on conflict(user_id) do update set headline=excluded.headline,subjects=excluded.subjects,
      levels=excluded.levels,store_name=excluded.store_name,
      store_description=excluded.store_description,all_subjects=excluded.all_subjects,
      all_levels=excluded.all_levels,updated_at=now();
  end if;
  return new;
end; $$;

alter table public.profiles
  drop column if exists phone,
  drop column if exists city,
  drop column if exists learner_kind,
  drop column if exists birth_year,
  drop column if exists school_class,
  drop column if exists university_year,
  drop column if exists study_field,
  drop column if exists child_class,
  drop column if exists signup_goal;
