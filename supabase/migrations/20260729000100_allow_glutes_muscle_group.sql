-- Группа «Ягодицы» (glutes) добавлена в каталог и в тип MuscleGroup, но
-- check-констрейнты на custom_exercises / workout_exercises остались со старым
-- набором и отклоняли сохранение упражнения в «Ягодицах» (у тренера и клиента).
-- Расширяем оба списка значением 'glutes'.

alter table public.custom_exercises drop constraint custom_exercises_group_allowed;
alter table public.custom_exercises add constraint custom_exercises_group_allowed check (
  muscle_group in ('legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other')
);

alter table public.workout_exercises drop constraint workout_exercises_group_allowed;
alter table public.workout_exercises add constraint workout_exercises_group_allowed check (
  muscle_group in ('legs', 'glutes', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio', 'other')
);
