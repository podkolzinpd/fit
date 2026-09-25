-- Keep editable legacy workouts aligned with the corrected system catalog.
-- Completed and cancelled history remains an immutable snapshot.
with corrected as (
update public.workout_exercises exercise
set
  input_kind = case exercise.exercise_ref
    when 'vital-gym-pro-r385-1473' then 'strength'
    when 'vital-gym-pro-r218-1538' then 'duration'
  end,
  updated_at = now()
from public.workouts workout
where workout.id = exercise.workout_id
  and workout.status in ('planned', 'in_progress')
  and exercise.exercise_source = 'system'
  and exercise.exercise_ref in (
    'vital-gym-pro-r385-1473',
    'vital-gym-pro-r218-1538'
  )
  and exercise.input_kind is distinct from case exercise.exercise_ref
    when 'vital-gym-pro-r385-1473' then 'strength'
    when 'vital-gym-pro-r218-1538' then 'duration'
  end
returning exercise.workout_id
)

update public.workouts workout
set
  version = workout.version + 1,
  updated_at = now()
where workout.status in ('planned', 'in_progress')
  and workout.id in (select corrected.workout_id from corrected);
