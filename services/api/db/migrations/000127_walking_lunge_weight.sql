-- Up Migration

-- Existing editable workout snapshots keep their original input kind. Align
-- this one reviewed system exercise with the catalog so active Live sessions
-- expose weight and repetitions. Sets (including entered values) are untouched.
with corrected as (
  update public.workout_exercises exercise
  set input_kind = 'strength', updated_at = now()
  from public.workouts workout
  where workout.id = exercise.workout_id
    and workout.status in ('planned', 'in_progress')
    and exercise.exercise_source = 'system'
    and exercise.exercise_ref = 'vital-walking-lunge-ex270'
    and exercise.input_kind = 'reps'
  returning exercise.workout_id
)
update public.workouts workout
set version = workout.version + 1, updated_at = now()
where workout.status in ('planned', 'in_progress')
  and workout.id in (select corrected.workout_id from corrected);

-- Down Migration

-- Existing training data corrections are intentionally irreversible.
