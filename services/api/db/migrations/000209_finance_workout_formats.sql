-- Up Migration
-- A manual single purchase and its attendance use the existing independent
-- receipt journals in the same transaction. No intermediate service survives a failure.
create or replace function public.create_manual_single_finance_session(
 p_client_id uuid,p_request_id uuid,p_workout_date date,p_price_cents bigint,
 p_paid_cents bigint,p_received_on date,p_comment text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare service jsonb;
begin
 service:=public.create_trainer_finance_service_v3(p_client_id,'session_pack','Разовое занятие',
  1,0,p_price_cents,p_paid_cents,p_workout_date,null,null,p_comment,p_received_on,p_request_id,true);
 return public.create_trainer_finance_manual_session(p_client_id,p_request_id,p_workout_date,
  'charged',(service->>'id')::uuid,p_comment);
end;
$$;
revoke all on function public.create_manual_single_finance_session(uuid,uuid,date,bigint,bigint,date,text) from public;
grant execute on function public.create_manual_single_finance_session(uuid,uuid,date,bigint,bigint,date,text) to fit_api;

alter table public.workouts add column if not exists delivery_mode text not null default 'in_person';
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.workouts'::regclass and conname='workouts_delivery_mode_check') then
  alter table public.workouts add constraint workouts_delivery_mode_check check(delivery_mode in ('in_person','online'));
 end if;
end $$;
create or replace function app_private.normalize_workout_delivery() returns trigger language plpgsql set search_path='' as $$
begin
 if new.training_format='self' then new.delivery_mode:='in_person'; end if;
 return new;
end $$;
drop trigger if exists normalize_workout_delivery on public.workouts;
create trigger normalize_workout_delivery before insert or update of training_format,delivery_mode on public.workouts
 for each row execute function app_private.normalize_workout_delivery();
create or replace function public.set_workout_delivery_mode(p_workout_id uuid,p_mode text,p_expected_version bigint)
 returns bigint language plpgsql security definer set search_path='' as $$
declare current_version bigint; current_format text; current_mode text;
begin
 if p_mode is null or p_mode not in ('in_person','online') then raise exception 'workout_invalid' using errcode='PT400'; end if;
 current_version:=public.set_workout_training_format(p_workout_id,null,p_expected_version,false);
 select training_format,delivery_mode into current_format,current_mode from public.workouts where id=p_workout_id;
 if current_format='self' and p_mode='online' then raise exception 'workout_forbidden' using errcode='PT403'; end if;
 if current_mode=p_mode then return current_version; end if;
 update public.workouts set delivery_mode=p_mode,version=version+1,updated_by=auth.uid() where id=p_workout_id returning version into current_version;
 return current_version;
end $$;
revoke all on function public.set_workout_delivery_mode(uuid,text,bigint) from public;
grant execute on function public.set_workout_delivery_mode(uuid,text,bigint) to fit_api;

-- Down Migration
-- Forward-only: preserve single purchases, payments and attendance history.
