-- Упражнения с собственным весом измеряются повторениями, а не фиктивными
-- килограммами. Исправляем сохранённый snapshot старых тренировок, чтобы
-- история, графики и PR пересчитались теми же серверными правилами.
update public.workout_exercises
set input_kind = 'reps'
where exercise_source = 'system'
  and input_kind = 'strength'
  and (
    exercise_ref in (
      'push-ups',
      'dips',
      'pull-ups',
      'close-grip-push-up',
      'crunches',
      'leg-raise',
      'russian-twist'
    )
    or (
      exercise_ref like 'fedb-%'
      and exercise_name like '%(Своё тело)%'
    )
  );

