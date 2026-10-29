-- Up Migration

-- Public read model, not a table grant: only an approved trainer's active offices
-- associated with an actually published profile can be exposed.
create function app_private.public_yandex_trainer_offices(p_public_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_agg(jsonb_build_object('city',o.city,'name',o.name) order by o.city,o.name,o.id)
  from public.trainer_professional_profiles p
  join public.corporate_trainers t on t.trainer_id=p.trainer_id and t.is_yandex
  join public.corporate_trainer_offices b on b.trainer_id=t.trainer_id
  join public.corporate_offices o on o.id=b.office_id and not o.archived
  where p.public_id=p_public_id and p.published_data is not null
$$;
revoke all on function app_private.public_yandex_trainer_offices(uuid) from public;
grant execute on function app_private.public_yandex_trainer_offices(uuid) to fit_api;

-- Down Migration

drop function app_private.public_yandex_trainer_offices(uuid);
