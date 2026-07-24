-- reorder_live_block: переставляет блок упражнений вверх/вниз в live-тренировке.
-- Блок = группа упражнений с одним block_id, упорядоченная по min(position).
-- Двигаем блок целиком (со всеми упражнениями), сохраняя их внутренний порядок.
-- Ограничений по подтверждённым подходам нет — двигать можно любые блоки.
create or replace function public.reorder_live_block(
  p_workout_id uuid,
  p_block_id uuid,
  p_direction smallint,
  p_expected_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  next_version bigint;
  target_block uuid := p_block_id;
  neighbour_block uuid;
  target_min smallint;
  cursor_position smallint := 0;
  block_row record;
begin
  if actor_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  if p_direction <> -1 and p_direction <> 1 then
    raise exception 'invalid_direction' using errcode = 'PT422';
  end if;

  update public.workouts
  set version = version + 1
  where id = p_workout_id and trainer_id = actor_id and status = 'in_progress'
    and deleted_at is null and version = p_expected_version
  returning version into next_version;
  if next_version is null then
    raise exception 'workout_conflict' using errcode = '40001';
  end if;

  -- Минимальная позиция целевого блока (определяет его место в списке блоков).
  select min(e.position) into target_min
  from public.workout_exercises e
  where e.workout_id = p_workout_id and e.block_id = target_block;
  if target_min is null then
    raise exception 'block_not_found' using errcode = 'PT404';
  end if;

  -- Сосед в направлении сдвига: ближайший блок выше (-1) или ниже (+1)
  -- по своей минимальной позиции.
  if p_direction = -1 then
    select e.block_id into neighbour_block
    from public.workout_exercises e
    where e.workout_id = p_workout_id
    group by e.block_id
    having min(e.position) < target_min
    order by min(e.position) desc
    limit 1;
  else
    select e.block_id into neighbour_block
    from public.workout_exercises e
    where e.workout_id = p_workout_id
    group by e.block_id
    having min(e.position) > target_min
    order by min(e.position) asc
    limit 1;
  end if;

  -- Граница списка: соседа нет — перестановка невозможна, тихий no-op.
  -- Версия уже поднята: клиент получит свежие данные, порядок не изменится.
  if neighbour_block is null then
    return next_version;
  end if;

  -- Уникальный индекс (workout_id, position) не даёт переставлять позиции
  -- напрямую — промежуточные значения коллизят. Сдвигаем все позиции в
  -- заведомо свободный диапазон, затем присваиваем финальные значения с нуля.
  update public.workout_exercises
  set position = position + 1000
  where workout_id = p_workout_id;

  -- Перенумеровываем ВСЕ упражнения тренировки подряд, обходя блоки в порядке
  -- их min(position), но меняя местами целевой и соседний блок. Внутри блока
  -- порядок упражнений сохраняется (order by position).
  for block_row in
    select bl.block_id,
           case
             when bl.block_id = target_block then
               (select min(x.position) from public.workout_exercises x
                where x.workout_id = p_workout_id and x.block_id = neighbour_block)
             when bl.block_id = neighbour_block then
               (select min(x.position) from public.workout_exercises x
                where x.workout_id = p_workout_id and x.block_id = target_block)
             else bl.min_pos
           end as sort_key
    from (
      select e.block_id, min(e.position) as min_pos
      from public.workout_exercises e
      where e.workout_id = p_workout_id
      group by e.block_id
    ) bl
    order by sort_key
  loop
    update public.workout_exercises e
    set position = cursor_position + sub.rn
    from (
      select id, (row_number() over (order by position) - 1)::smallint as rn
      from public.workout_exercises
      where workout_id = p_workout_id and block_id = block_row.block_id
    ) sub
    where e.id = sub.id;

    cursor_position := cursor_position + (
      select count(*)::smallint from public.workout_exercises
      where workout_id = p_workout_id and block_id = block_row.block_id
    );
  end loop;

  return next_version;
end;
$$;

revoke all on function public.reorder_live_block(uuid, uuid, smallint, bigint) from public, anon;
grant execute on function public.reorder_live_block(uuid, uuid, smallint, bigint) to authenticated;

-- Конфликт версии в live-reorder — бизнес-конфликт, не транзакционный дедлок:
-- клиент устарел и должен перечитать данные, а не ретраить вслепую.
do $$
declare
  definition text := pg_get_functiondef('public.reorder_live_block(uuid,uuid,smallint,bigint)'::regprocedure);
begin
  if definition not like '%40001%' then
    raise exception 'expected retryable conflict code in reorder_live_block';
  end if;
  execute replace(definition, '40001', 'PT409');
end;
$$;
