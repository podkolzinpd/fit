-- Беговые интервалы используют тот же workout aggregate, что сеты и круги,
-- но получают собственное понятное название пресета. Старый отдельный ref
-- interval-running сводим к каноническому running, чтобы история и прогресс
-- одного вида активности не распадались на две сущности.

alter table public.workout_exercises
  drop constraint if exists workout_exercises_block_preset_allowed;

alter table public.workout_exercises
  add constraint workout_exercises_block_preset_allowed
  check (block_preset in ('set', 'circuit', 'interval'));

update public.workout_exercises
set exercise_ref = 'running'
where exercise_source = 'system'
  and exercise_ref = 'interval-running';

