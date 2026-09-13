create index if not exists trainer_profiles_catalog_order_idx
  on public.trainer_professional_profiles (
    (((published_data->>'acceptingClients')::boolean)) desc,
    published_at desc,
    (lower(published_data->>'displayName')),
    public_id
  )
  where listed_in_catalog and published_data is not null;
