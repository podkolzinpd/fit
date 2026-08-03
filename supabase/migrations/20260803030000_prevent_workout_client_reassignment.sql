-- Клиент является владельцем истории тренировки и не может меняться при
-- редактировании уже созданной записи. Это защищает все RPC-пути, включая
-- временный переход completed → planned при правке завершённой тренировки.
create or replace function private.prevent_workout_client_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.client_id is distinct from new.client_id then
    raise exception 'workout_client_immutable' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_prevent_client_reassignment on public.workouts;
create trigger workouts_prevent_client_reassignment
before update of client_id on public.workouts
for each row execute function private.prevent_workout_client_reassignment();
