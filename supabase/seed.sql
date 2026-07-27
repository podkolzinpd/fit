insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, last_sign_in_at, is_super_admin, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '90000000-0000-4000-8000-000000000009',
  'authenticated', 'authenticated', 'trainer@fit.local',
  crypt('FitLocal123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Тест","last_name":"Тренер"}', '', '', '', '', now(), false, now(), now()
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id
) values (
  'trainer@fit.local', '90000000-0000-4000-8000-000000000009',
  '{"sub":"90000000-0000-4000-8000-000000000009","email":"trainer@fit.local"}',
  'email', now(), now(), now(), '91000000-0000-4000-8000-000000000019'
) on conflict (provider_id, provider) do nothing;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, last_sign_in_at, is_super_admin, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '92000000-0000-4000-8000-000000000029',
  'authenticated', 'authenticated', 'client@fit.local',
  crypt('FitLocal123!', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}',
  '{"first_name":"Анна","last_name":"Смирнова"}', '', '', '', '', now(), false, now(), now()
) on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id
) values (
  'client@fit.local', '92000000-0000-4000-8000-000000000029',
  '{"sub":"92000000-0000-4000-8000-000000000029","email":"client@fit.local"}',
  'email', now(), now(), now(), '93000000-0000-4000-8000-000000000039'
) on conflict (provider_id, provider) do nothing;

insert into public.profiles (id, first_name, last_name)
values (
  '90000000-0000-4000-8000-000000000009',
  'Тест',
  'Тренер'
) on conflict (id) do nothing;

insert into public.trainers (profile_id)
values ('90000000-0000-4000-8000-000000000009')
on conflict (profile_id) do nothing;

insert into public.clients (
  id,
  trainer_id,
  auth_user_id,
  full_name,
  gender,
  age_years,
  age_updated_at,
  height_cm,
  goal
) values (
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  '92000000-0000-4000-8000-000000000029',
  'Анна Смирнова',
  'female',
  31,
  '2026-07-01',
  168,
  'Повысить силовые показатели и улучшить выносливость'
) on conflict (id) do nothing;

insert into public.client_private_details (client_id, trainer_id, note)
values (
  '11111111-1111-4111-8111-111111111111',
  '90000000-0000-4000-8000-000000000009',
  'Локальный демонстрационный клиент'
) on conflict (client_id) do nothing;

insert into public.client_progress (
  id,
  trainer_id,
  client_id,
  recorded_on,
  weight_kg
) values
  (
    '94000000-0000-4000-8000-000000000041',
    '90000000-0000-4000-8000-000000000009',
    '11111111-1111-4111-8111-111111111111',
    '2026-01-28',
    67.4
  ),
  (
    '94000000-0000-4000-8000-000000000042',
    '90000000-0000-4000-8000-000000000009',
    '11111111-1111-4111-8111-111111111111',
    '2026-07-27',
    65.8
  )
on conflict (id) do nothing;

insert into public.client_training_summaries (
  id,
  trainer_id,
  client_id,
  period_start,
  period_end,
  summary,
  trainer_summary,
  client_summary,
  display_metrics,
  model_uri,
  prompt_version,
  input_fingerprint,
  input_stats,
  generated_at
) values
  (
    '95000000-0000-4000-8000-000000000051',
    '90000000-0000-4000-8000-000000000009',
    '11111111-1111-4111-8111-111111111111',
    '2026-06-28',
    '2026-07-27',
    'Положительная динамика есть, но период пока короткий для устойчивого вывода.',
    '{"headline":"Положительная динамика есть, но период пока короткий для устойчивого вывода.","progress":["Жим лёжа: рабочий вес вырос с 72 до 75 кг (+4%).","Приседания: объём сохранился на уровне прошлого месяца."],"consistency":"4 тренировки за 4 недели, максимальный перерыв — 9 дней.","attention":["Уточнить: достаточно ли четырёх наблюдений для изменения программы."]}',
    '{"headline":"За последний месяц рабочий вес в жиме вырос на 4%.","achievements":["Жим лёжа: рабочий вес вырос с 72 до 75 кг.","Удалось сохранить объём в приседаниях на уровне прошлого месяца."],"consistency":"За четыре недели выполнено 4 тренировки.","encouragement":"Первый заметный сдвиг уже есть — продолжай двигаться в своём темпе."}',
    '{"completed_workouts":4,"workouts_per_week":1.0,"active_weeks":4,"longest_gap_days":9}',
    'gpt://local/yandexgpt-lite/latest',
    'training-progress-v3',
    'local-demo-1m',
    '{"workouts":4,"exercises":8,"sets":24}',
    '2026-07-27 10:10:00+00'
  ),
  (
    '95000000-0000-4000-8000-000000000052',
    '90000000-0000-4000-8000-000000000009',
    '11111111-1111-4111-8111-111111111111',
    '2026-04-28',
    '2026-07-27',
    'Рабочие веса растут, при этом регулярность остаётся неоднородной.',
    '{"headline":"Рабочие веса растут, при этом регулярность остаётся неоднородной.","progress":["Жим лёжа: 67 → 75 кг (+12%), объём вырос на 15%.","Приседания: 90 → 100 кг (+11%), лучший результат — 100 кг.","Бег: темп улучшился на 6% при росте дистанции до 5 км."],"consistency":"11 тренировок за 13 недель, максимальный перерыв — 16 дней.","attention":["Проверить: с чем связан 16-дневный перерыв в апреле."]}',
    '{"headline":"За три месяца выросли результаты в силовых упражнениях и беге.","achievements":["Жим лёжа: рабочий вес вырос с 67 до 75 кг (+12%).","Приседания: рабочий вес вырос с 90 до 100 кг (+11%).","В беге темп улучшился на 6%, а дистанция выросла до 5 км."],"consistency":"За 13 недель выполнено 11 тренировок.","encouragement":"Прогресс заметен сразу в нескольких направлениях — это сильный результат периода."}',
    '{"completed_workouts":11,"workouts_per_week":0.9,"active_weeks":10,"longest_gap_days":16}',
    'gpt://local/yandexgpt-lite/latest',
    'training-progress-v3',
    'local-demo-3m',
    '{"workouts":11,"exercises":22,"sets":66}',
    '2026-07-27 10:10:00+00'
  ),
  (
    '95000000-0000-4000-8000-000000000053',
    '90000000-0000-4000-8000-000000000009',
    '11111111-1111-4111-8111-111111111111',
    '2026-01-28',
    '2026-07-27',
    'Заметный прогресс в силовых упражнениях и беге при нерегулярном графике.',
    '{"headline":"Заметный прогресс в силовых упражнениях и беге при нерегулярном графике.","progress":["Жим лёжа: 60 → 75 кг (+25%), объём вырос с 1 800 до 2 250 кг.","Приседания: 80 → 100 кг (+25%), лучший рабочий вес — 100 кг.","Бег: дистанция 3 → 5 км, темп улучшился на 10%."],"consistency":"24 тренировки за 26 недель, средняя частота — 0,9 в неделю.","attention":["Проверить: причина максимального перерыва в 21 день."]}',
    '{"headline":"За полгода силовые показатели выросли на 25%, а бег стал быстрее и длиннее.","achievements":["Жим лёжа: рабочий вес вырос с 60 до 75 кг (+25%).","Приседания: рабочий вес вырос с 80 до 100 кг (+25%).","Бег: дистанция выросла с 3 до 5 км, а темп улучшился на 10%."],"consistency":"За 26 недель выполнено 24 тренировки, активность была в 20 неделях.","encouragement":"За полгода ты заметно продвинулась сразу в силе и выносливости."}',
    '{"completed_workouts":24,"workouts_per_week":0.9,"active_weeks":20,"longest_gap_days":21}',
    'gpt://local/yandexgpt-lite/latest',
    'training-progress-v3',
    'local-demo-6m',
    '{"workouts":24,"exercises":48,"sets":144}',
    '2026-07-27 10:10:00+00'
  )
on conflict (id) do nothing;

insert into public.client_published_training_summaries (
  id,
  source_summary_id,
  trainer_id,
  client_id,
  period_start,
  period_end,
  summary,
  display_metrics,
  generated_at,
  published_at,
  published_by
)
select
  gen_random_uuid(),
  summary.id,
  summary.trainer_id,
  summary.client_id,
  summary.period_start,
  summary.period_end,
  summary.client_summary,
  summary.display_metrics,
  summary.generated_at,
  '2026-07-27 10:15:00+00',
  summary.trainer_id
from public.client_training_summaries summary
where summary.client_id = '11111111-1111-4111-8111-111111111111'
on conflict (client_id, period_start, period_end) do nothing;
