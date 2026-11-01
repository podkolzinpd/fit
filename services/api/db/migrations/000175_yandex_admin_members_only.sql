-- Up Migration

-- The existing cabinet belongs to Yandex. Preserve metadata; restrict both API generations.
create or replace function app_private.corporate_admin_bundle() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  return jsonb_build_object(
    'offices', coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'city',o.city,'name',o.name,'address',o.address,
      'archived',o.archived,'version',o.version) order by o.city,o.name,o.id)
      from public.corporate_offices o),'[]'::jsonb),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.profile_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'isYandex',coalesce(c.is_yandex,false),'version',coalesce(c.version,0),
      'officeIds',coalesce((select jsonb_agg(b.office_id order by b.office_id)
        from public.corporate_trainer_offices b where b.trainer_id=t.profile_id),'[]'::jsonb))
      order by p.first_name,p.last_name,t.profile_id)
      from public.trainers t join public.profiles p on p.id=t.profile_id
      join public.corporate_trainers c on c.trainer_id=t.profile_id and c.is_yandex
      where p.account_role='trainer'),'[]'::jsonb));
end $$;

-- Independent owner-managed slots preserve the existing administrator.
alter table app_private.corporate_admin_logins
  add column access_slot smallint not null default 1 check(access_slot between 1 and 2);
drop index app_private.corporate_admin_one_enabled_login;
create unique index corporate_admin_enabled_slot
  on app_private.corporate_admin_logins(access_slot) where enabled;

create function app_private.corporate_trainer_update_allowed(p_id uuid,p_enabled boolean,p_offices uuid[],p_version bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select app_private.is_corporate_admin() and exists(
    select 1 from public.corporate_trainers c where c.trainer_id=p_id and (
      c.is_yandex or (not p_enabled and not c.is_yandex and c.version=p_version+1
        and coalesce((select array_agg(b.office_id order by b.office_id) from public.corporate_trainer_offices b where b.trainer_id=p_id),'{}'::uuid[])
          =coalesce((select array_agg(distinct x order by x) from unnest(p_offices) x),'{}'::uuid[])
        and exists(select 1 from app_private.corporate_admin_audit a where a.entity_kind='trainer' and a.entity_id=p_id
          and a.before_data->>'isYandex'='true' and a.after_data->>'isYandex'='false'))))
$$;
revoke all on function app_private.corporate_trainer_update_allowed(uuid,boolean,uuid[],bigint) from public;
grant execute on function app_private.corporate_trainer_update_allowed(uuid,boolean,uuid[],bigint) to fit_api;

-- Down Migration
drop function app_private.corporate_trainer_update_allowed(uuid,boolean,uuid[],bigint);
-- Refuse to discard a second enabled administrator during a rollback.
do $$ begin
  if exists(select 1 from app_private.corporate_admin_logins where enabled and access_slot=2) then
    raise exception 'corporate_second_admin_requires_explicit_revoke';
  end if;
end $$;
drop index app_private.corporate_admin_enabled_slot;
alter table app_private.corporate_admin_logins drop column access_slot;
create unique index corporate_admin_one_enabled_login on app_private.corporate_admin_logins((true)) where enabled;


create or replace function app_private.corporate_admin_bundle() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_corporate_admin() then
    raise exception 'corporate_forbidden' using errcode='PT403';
  end if;
  return jsonb_build_object(
    'offices', coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'city',o.city,'name',o.name,'address',o.address,
      'archived',o.archived,'version',o.version) order by o.city,o.name,o.id)
      from public.corporate_offices o),'[]'::jsonb),
    'trainers', coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.profile_id,'name',coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'Имя не указано'),
      'isYandex',coalesce(c.is_yandex,false),'version',coalesce(c.version,0),
      'officeIds',coalesce((select jsonb_agg(b.office_id order by b.office_id)
        from public.corporate_trainer_offices b where b.trainer_id=t.profile_id),'[]'::jsonb))
      order by p.first_name,p.last_name,t.profile_id)
      from public.trainers t join public.profiles p on p.id=t.profile_id
      left join public.corporate_trainers c on c.trainer_id=t.profile_id
      where p.account_role='trainer'),'[]'::jsonb));
end $$;
