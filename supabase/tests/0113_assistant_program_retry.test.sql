begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id, instance_id, aud, role, email) values
('50000000-0000-4000-8000-000000000114','00000000-0000-0000-0000-000000000000','authenticated','authenticated','program-retry@example.test');
insert into public.profiles(id,account_role) values ('50000000-0000-4000-8000-000000000114','trainer');
insert into public.trainers(profile_id) values ('50000000-0000-4000-8000-000000000114');
insert into public.clients(id,trainer_id,full_name,gender,age_years,height_cm) values ('c0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','Program retry','male',30,180);
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000114')->>'status','claimed','first attempt claims');
select ok(not public.release_assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000115','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000114'),'another owner cannot release');
select ok(public.release_assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000114'),'failed attempt releases');
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000115')->>'status','claimed','retry starts immediately');
select ok(not public.release_assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000114'),'stale attempt cannot release current one');
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000115','{"ok":true}')->>'status','complete','retry completes');
select ok(not public.release_assistant_program_generation_job('a0000000-0000-4000-8000-000000000114','50000000-0000-4000-8000-000000000114','c0000000-0000-4000-8000-000000000114','b0000000-0000-4000-8000-000000000115'),'release never erases completed result');
select ok(not has_function_privilege('authenticated','public.release_assistant_program_generation_job(uuid,uuid,uuid,uuid)','execute'),'browser cannot release jobs');
select * from finish();
rollback;
