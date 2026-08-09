-- Connected trainers may read the root trainer's AI summary for their shared client.
drop policy if exists "training_summaries_read_own" on public.client_training_summaries;

create policy "training_summaries_read_accessible" on public.client_training_summaries
  for select to authenticated using (
    trainer_id = (select auth.uid())
    or exists (
      select 1
      from public.clients client
      join public.client_trainers membership on membership.client_id = client.id
      where client.id = client_training_summaries.client_id
        and client.trainer_id = client_training_summaries.trainer_id
        and membership.trainer_id = (select auth.uid())
    )
  );
