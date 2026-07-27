-- Client-generated summaries are visible immediately; trainer publication remains optional.
alter table public.client_published_training_summaries
  alter column published_by drop not null;
