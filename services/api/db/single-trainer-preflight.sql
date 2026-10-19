-- Read-only aggregate preflight; no names, accounts, invite secrets or repair.
begin read only;
with inventory as (
  select client.id, client.auth_user_id, client.trainer_id,
    (select count(*) from public.client_trainer_relationships relationship
      where relationship.client_id = client.id) as period_count,
    (select count(*) from public.client_trainer_relationships relationship
      where relationship.client_id = client.id and relationship.status = 'active') as active_count,
    (select count(*) from public.client_trainer_relationships relationship
      where relationship.client_id = client.id and relationship.status = 'active'
        and not exists (select 1 from public.client_trainers membership
          where membership.client_id = client.id and membership.trainer_id = relationship.trainer_id)) as active_without_membership,
    (select count(*) from (
      select membership.trainer_id from public.client_trainers membership where membership.client_id = client.id
      union select trainer.profile_id from public.trainers trainer where trainer.profile_id = client.trainer_id
    ) candidate) as legacy_candidates,
    (select count(*) from public.client_trainers membership where membership.client_id = client.id
      and not exists (select 1 from public.client_trainer_relationships relationship
        where relationship.client_id = client.id and relationship.trainer_id = membership.trainer_id
          and relationship.status = 'active')) as stale_memberships
  from public.clients client where client.merged_into_client_id is null
)
select count(*) as cards,
  count(*) filter (where auth_user_id is null) as unclaimed,
  count(*) filter (where active_count = 1 and stale_memberships = 0 and active_without_membership = 0) as consistent,
  count(*) filter (where active_without_membership > 0) as active_without_membership,
  count(*) filter (where auth_user_id is not null and period_count = 0 and legacy_candidates = 1) as unambiguous_legacy,
  count(*) filter (where auth_user_id is not null and period_count = 0 and legacy_candidates > 1) as ambiguous_legacy_blockers,
  count(*) filter (where active_count > 1) as multiple_active_blockers,
  count(*) filter (where stale_memberships > 0) as cards_with_retained_stale_metadata,
  count(*) filter (where auth_user_id is not null and trainer_id <> auth_user_id) as historical_trainer_partitions
from inventory;
rollback;
