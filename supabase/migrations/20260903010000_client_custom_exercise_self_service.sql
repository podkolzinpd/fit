-- Пользовательское упражнение принадлежит автору, но хранится в том же
-- разделе данных, что и его тренировки. Это сохраняет существующие составные
-- внешние ключи и позволяет клиенту использовать упражнение в своей записи.
alter table public.custom_exercises
  add column created_by uuid;

-- Все существующие строки были созданы тренером-владельцем раздела. ID и
-- ссылки из workout_exercises при этом не меняются.
update public.custom_exercises
set created_by = trainer_id
where created_by is null;

alter table public.custom_exercises
  alter column created_by set default auth.uid(),
  alter column created_by set not null,
  add constraint custom_exercises_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete restrict;

-- Самостоятельный клиент сам является владельцем своего раздела данных, но у
-- него намеренно нет строки в public.trainers. Поэтому раздел ссылается на
-- profile, как уже делает clients.trainer_id.
alter table public.custom_exercises
  drop constraint custom_exercises_trainer_id_fkey,
  add constraint custom_exercises_partition_owner_fk
    foreign key (trainer_id) references public.profiles(id) on delete restrict;

-- Автор назначается default auth.uid(), а RLS проверяет его при INSERT.
-- После создания клиентский Data API меняет только содержимое, но не автора,
-- раздел или ID. Привилегии колонок обеспечивают это без auth/business trigger.
revoke update on public.custom_exercises from authenticated;
grant update (name, muscle_group, input_kind, archived_at, version)
  on public.custom_exercises to authenticated;

drop index custom_exercises_active_name_uidx;
create unique index custom_exercises_active_author_name_uidx
  on public.custom_exercises (created_by, lower(btrim(name)))
  where archived_at is null;

drop policy "custom_exercises_read_own" on public.custom_exercises;
drop policy "custom_exercises_insert_own" on public.custom_exercises;
drop policy "custom_exercises_update_own" on public.custom_exercises;

-- Автор всегда видит своё упражнение. Тренер видит упражнения в собственном
-- разделе и упражнения доступных ему клиентов. Клиент в общем разделе видит
-- только свои строки и строки, созданные владельцем этого раздела, но не
-- упражнения других клиентов.
create policy "custom_exercises_read_accessible" on public.custom_exercises
  for select to authenticated using (
    created_by = (select auth.uid())
    or trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients client
      where client.auth_user_id = public.custom_exercises.created_by
        and client.trainer_id = public.custom_exercises.trainer_id
        and public.can_access_client(client.id)
    )
    or (
      created_by = trainer_id
      and exists (
        select 1
        from public.clients client
        where client.auth_user_id = (select auth.uid())
          and client.trainer_id = public.custom_exercises.trainer_id
          and client.archived_at is null
      )
    )
  );

create policy "custom_exercises_insert_accessible" on public.custom_exercises
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and (
      exists (
        select 1 from public.trainers trainer
        where trainer.profile_id = (select auth.uid())
          and public.custom_exercises.trainer_id = trainer.profile_id
      )
      or exists (
        select 1 from public.clients client
        where client.auth_user_id = (select auth.uid())
          and client.trainer_id = public.custom_exercises.trainer_id
          and client.archived_at is null
      )
    )
  );

create policy "custom_exercises_update_accessible" on public.custom_exercises
  for update to authenticated using (
    created_by = (select auth.uid())
    or trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients client
      where client.auth_user_id = public.custom_exercises.created_by
        and client.trainer_id = public.custom_exercises.trainer_id
        and public.can_access_client(client.id)
    )
  ) with check (
    created_by = (select auth.uid())
    or trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients client
      where client.auth_user_id = public.custom_exercises.created_by
        and client.trainer_id = public.custom_exercises.trainer_id
        and public.can_access_client(client.id)
    )
  );
