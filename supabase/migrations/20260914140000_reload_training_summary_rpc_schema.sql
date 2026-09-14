-- The functions already exist and are covered by pgTAP. Re-applying the
-- narrow grants and reloading PostgREST makes late forward-only migrations
-- visible to the production service-role client without changing data.
grant select, insert, update on public.client_training_summaries to service_role;
grant select, insert, update on public.client_published_training_summaries to service_role;

grant execute on function public.claim_training_summary_generation(
  uuid, date, date, text, uuid, integer, integer
) to service_role;
grant execute on function public.complete_training_summary_generation(
  uuid, date, date, text, uuid, jsonb
) to service_role;
grant execute on function public.fail_training_summary_generation(
  uuid, date, date, text, uuid, text, jsonb
) to service_role;
grant execute on function public.publish_cached_training_summary_for_client(
  uuid, date, date, text, text
) to service_role;

notify pgrst, 'reload schema';
