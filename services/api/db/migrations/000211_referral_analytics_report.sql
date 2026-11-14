-- Up Migration
alter function app_private.private_analytics_explore(jsonb) rename to private_analytics_explore_before_referrals;
revoke execute on function app_private.private_analytics_explore_before_referrals(jsonb) from fit_api;

create function app_private.private_analytics_explore(p jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  date_from date := (p->>'from')::date;
  date_to date := (p->>'to')::date;
  page_number integer := coalesce((p->>'page')::integer,1);
  page_size integer := coalesce((p->>'pageSize')::integer,50);
  grouping text := coalesce(p->>'group','day');
  result jsonb;
begin
  if not app_private.is_private_analytics_allowed() then
    raise exception using errcode='PT403',message='analytics_forbidden';
  end if;
  if coalesce(p->>'section','people') <> 'referrals' then
    return app_private.private_analytics_explore_before_referrals(p);
  end if;
  if date_from is null or date_to is null or date_to < date_from or date_to-date_from > 1095
    or page_number not between 1 and 1000000 or page_size not between 1 and 500
    or grouping not in ('day','week','month') then
    raise exception using errcode='PT422',message='analytics_invalid';
  end if;
  with sources as materialized (
    select s.* from app_private.referral_sources s
    where coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(s.label||' '||s.code))>0
  ), clicks as materialized (
    select c.* from app_private.referral_clicks c join sources s on s.id=c.source_id
    where c.clicked_at >= date_from::timestamp at time zone 'Europe/Moscow'
      and c.clicked_at < (date_to+1)::timestamp at time zone 'Europe/Moscow'
  ), registrations as materialized (
    select r.* from app_private.referral_registrations r join sources s on s.id=r.source_id
    where r.registered_at >= date_from::timestamp at time zone 'Europe/Moscow'
      and r.registered_at < (date_to+1)::timestamp at time zone 'Europe/Moscow'
  ), totals as materialized (
    select s.id::text id,s.label name,s.code,s.active,
      (select count(*) from clicks c where c.source_id=s.id) clicks,
      (select count(*) from registrations r where r.source_id=s.id) registrations
    from sources s
  ), report as materialized (
    select t.*,round(100.0*registrations/nullif(clicks,0),2) conversion from totals t
  ), sorted as (
    select * from report order by
      case when p->>'direction'='asc' then case p->>'sort' when 'name' then name when 'code' then code when 'active' then active::text end end asc,
      case when coalesce(p->>'direction','desc')='desc' then case p->>'sort' when 'name' then name when 'code' then code when 'active' then active::text end end desc,
      case when coalesce(p->>'direction','desc')='desc' then case p->>'sort' when 'registrations' then registrations when 'conversion' then conversion when 'clicks' then clicks end end desc nulls last,
      case when p->>'direction'='asc' then case p->>'sort' when 'registrations' then registrations when 'conversion' then conversion when 'clicks' then clicks end end asc nulls last,
      code
    limit page_size offset (page_number-1)*page_size
  ), events as (
    select clicked_at occurred_at,1 clicks,0 registrations from clicks
    union all select registered_at,0,1 from registrations
  ), trend as (
    select date_trunc(grouping,occurred_at at time zone 'Europe/Moscow')::date as bucket_day,
      sum(clicks) actions,sum(registrations) registrations from events group by 1
  )
  select jsonb_build_object(
    'computedAt',now(),'observationStartedAt','2026-11-11T08:33:53Z',
    'retentionMeasured',false,'revision',(select md5(coalesce(jsonb_agg(to_jsonb(r) order by r.code)::text,'[]')) from report r),
    'total',(select count(*) from report),'rows',coalesce((select jsonb_agg(to_jsonb(s)) from sorted s),'[]'::jsonb),
    'summary',jsonb_strip_nulls(jsonb_build_object('clicks',(select count(*) from clicks),'registrations',(select count(*) from registrations),
      'conversion',round(100.0*(select count(*) from registrations)/nullif((select count(*) from clicks),0),2))),
    'trend',coalesce((select jsonb_agg(jsonb_build_object('date',bucket_day,'actions',actions,'users',0,'registrations',registrations) order by bucket_day) from trend),'[]'::jsonb),
    'features','[]'::jsonb
  ) into result;
  return result;
end $$;
revoke all on function app_private.private_analytics_explore(jsonb) from public;
grant execute on function app_private.private_analytics_explore(jsonb) to fit_api;

-- Down Migration
drop function app_private.private_analytics_explore(jsonb);
alter function app_private.private_analytics_explore_before_referrals(jsonb) rename to private_analytics_explore;
grant execute on function app_private.private_analytics_explore(jsonb) to fit_api;
