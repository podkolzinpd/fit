-- Up Migration

insert into app_private.referral_sources (code, label)
values
  ('staff-002', 'Сотрудник 2'),
  ('staff-003', 'Сотрудник 3'),
  ('staff-004', 'Сотрудник 4'),
  ('staff-005', 'Сотрудник 5'),
  ('staff-006', 'Сотрудник 6')
on conflict (code) do nothing;

-- Down Migration

-- Preserve source references and attribution history if this seed is rolled back.
update app_private.referral_sources set active = false
where code in ('staff-002', 'staff-003', 'staff-004', 'staff-005', 'staff-006');
