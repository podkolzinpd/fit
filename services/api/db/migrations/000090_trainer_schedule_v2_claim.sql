-- Up Migration

create table app_private.experiment_claim_tokens (
  token_hash text primary key,
  experiment_key text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint experiment_claim_tokens_hash_format
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint experiment_claim_tokens_key_allowed
    check (experiment_key in ('trainer_schedule_v2')),
  constraint experiment_claim_tokens_consumption_consistent
    check ((consumed_at is null) = (consumed_by is null))
);

revoke all on app_private.experiment_claim_tokens from public;

insert into app_private.experiment_claim_tokens (
  token_hash,
  experiment_key,
  expires_at
) values (
  '1a624a68e8693aabdca34a5ac5cdaf28e5bbfcf2c9e85ca033d61379ca66e566',
  'trainer_schedule_v2',
  '2026-10-25T23:59:59+03:00'
);

-- Down Migration

drop table app_private.experiment_claim_tokens;
