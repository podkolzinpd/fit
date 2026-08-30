drop policy if exists "user_feature_flags_read_own" on public.user_feature_flags;
revoke all on public.user_feature_flags from anon, authenticated;

comment on table public.user_feature_flags is
  'Retired UI rollout storage. No runtime reads or grants remain; physical removal requires the repository manual destructive-migration procedure.';
