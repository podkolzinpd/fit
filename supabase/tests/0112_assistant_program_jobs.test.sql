begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id, instance_id, aud, role, email) values
('50000000-0000-4000-8000-000000000112','00000000-0000-0000-0000-000000000000','authenticated','authenticated','program-jobs@example.test'),
('50000000-0000-4000-8000-000000000113','00000000-0000-0000-0000-000000000000','authenticated','authenticated','program-other@example.test');
insert into public.profiles(id,account_role) values ('50000000-0000-4000-8000-000000000112','trainer'),('50000000-0000-4000-8000-000000000113','trainer');
insert into public.trainers(profile_id) values ('50000000-0000-4000-8000-000000000112'),('50000000-0000-4000-8000-000000000113');
insert into public.clients(id,trainer_id,full_name,gender,age_years,height_cm) values ('c0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','Program jobs','male',30,180);
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000112')->>'status','claimed','first request owns job');
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000113')->>'status','busy','different turn cannot own same active job');
select throws_ok($$select public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000113','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000113')$$,'PT403','program_job_owner_mismatch','cross actor cannot reuse job');
select throws_ok($$select public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000113','{"ok":true}')$$,'PT409','program_job_conflict','nonowner lease cannot complete');
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000112','{"ok":true}')->>'status','complete','owner completes job');
select is(public.assistant_program_generation_job('a0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','c0000000-0000-4000-8000-000000000112','b0000000-0000-4000-8000-000000000113')->'result','{"ok":true}'::jsonb,'new turn reads same completed result');
select ok(not has_function_privilege('authenticated','public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb)','execute'),'browser cannot claim jobs');
select ok(not has_table_privilege('authenticated','private.assistant_program_generations','select'),'browser cannot read other job results');
select ok(has_function_privilege('service_role','public.assistant_program_generation_job(uuid,uuid,uuid,uuid,jsonb)','execute'),'only server calls job RPC');
insert into public.assistant_conversations(id,owner_id,title) values('d0000000-0000-4000-8000-000000000112','50000000-0000-4000-8000-000000000112','Revision test');
do $$ begin
  perform public.persist_assistant_response('d0000000-0000-4000-8000-000000000112','d1000000-0000-4000-8000-000000000112','Draft',
    '{"id":"d2000000-0000-4000-8000-000000000112","tool":"create_program_draft","status":"proposed","title":"Program","description":"Draft","payload":{"programId":"d3000000-0000-4000-8000-000000000112","programPilot":true}}');
  perform public.persist_assistant_response('d0000000-0000-4000-8000-000000000112','d1000000-0000-4000-8000-000000000113','Edited draft',
    '{"id":"d2000000-0000-4000-8000-000000000113","tool":"create_program_draft","status":"proposed","title":"Program","description":"Edited draft","payload":{"programId":"d3000000-0000-4000-8000-000000000112","programPilot":true}}');
end $$;
select is((select status from public.assistant_actions where id='d2000000-0000-4000-8000-000000000112'),'cancelled','old program revision is revoked atomically');
select is((select status from public.assistant_actions where id='d2000000-0000-4000-8000-000000000113'),'proposed','edited revision remains available');
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000112',true);
select throws_ok($$select public.apply_assistant_action('d2000000-0000-4000-8000-000000000112','{}',1)$$,'PT409','assistant_action_conflict','old browser tab cannot save the previous revision');
reset role;
select * from finish();
rollback;
