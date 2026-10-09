-- Up Migration
-- Additive atomic drag/drop command. Existing adjacent reorder remains unchanged.
create function public.move_live_block(
  p_workout_id uuid, p_block_id uuid, p_target_index integer,
  p_expected_version bigint, p_operation_id uuid
)
returns table (resource_id uuid, version bigint, replayed boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_order integer;
  destination integer := p_target_index + 1;
  block_count integer;
  replayed_version bigint;
  next_version bigint;
begin
  perform app_private.authorize_live_workout(p_workout_id);
  if p_target_index is null or p_target_index < 0 or p_target_index > 199 then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  replayed_version := app_private.claim_live_workout_operation(
    'reorder_block', p_block_id, p_operation_id,
    encode(sha256(convert_to('move:' || p_workout_id::text || ':' || p_expected_version::text || ':' || p_target_index::text, 'UTF8')), 'hex')
  );
  if replayed_version is not null then
    return query select p_block_id, replayed_version, true;
    return;
  end if;
  update public.workouts w set updated_by = actor_id, version = w.version + 1
  where w.id = p_workout_id and w.status = 'in_progress'
    and w.deleted_at is null and w.version = p_expected_version
  returning w.version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = 'PT409';
  end if;
  select count(distinct e.block_id)::integer into block_count
  from public.workout_exercises e where e.workout_id = p_workout_id;
  select b.block_order into target_order from (
    select e.block_id, row_number() over (order by min(e.position), e.block_id)::integer block_order
    from public.workout_exercises e where e.workout_id = p_workout_id group by e.block_id
  ) b where b.block_id = p_block_id;
  if target_order is null then
    raise exception 'block_not_found' using errcode = 'PT404';
  end if;
  if destination > block_count then
    raise exception 'workout_invalid' using errcode = 'PT422';
  end if;
  set constraints all deferred;
  with block_orders as (
    select e.block_id, row_number() over (order by min(e.position), e.block_id)::integer block_order
    from public.workout_exercises e where e.workout_id = p_workout_id group by e.block_id
  ), moved_blocks as (
    select b.block_id, case
      when b.block_id = p_block_id then destination
      when target_order < destination and b.block_order > target_order and b.block_order <= destination then b.block_order - 1
      when target_order > destination and b.block_order >= destination and b.block_order < target_order then b.block_order + 1
      else b.block_order end new_block_order
    from block_orders b
  ), ordered_exercises as (
    select e.id, (row_number() over (order by b.new_block_order, e.position, e.id) - 1)::smallint new_position
    from public.workout_exercises e join moved_blocks b on b.block_id = e.block_id
    where e.workout_id = p_workout_id
  )
  update public.workout_exercises e set position = o.new_position, updated_by = actor_id
  from ordered_exercises o where e.id = o.id and e.position <> o.new_position;
  perform app_private.complete_live_workout_operation(p_operation_id, next_version, p_block_id);
  return query select p_block_id, next_version, false;
end;
$$;
revoke all on function public.move_live_block(uuid, uuid, integer, bigint, uuid) from public;
grant execute on function public.move_live_block(uuid, uuid, integer, bigint, uuid) to fit_api;

-- Down Migration
drop function public.move_live_block(uuid, uuid, integer, bigint, uuid);
