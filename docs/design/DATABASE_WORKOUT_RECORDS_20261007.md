# Личные рекорды выбранной тренировки — 2026-10-07

Поток: data-media. База: main ca796686. Один PR, без нового UI/пилота.
Результат: рекорды старой тренировки не зависят от первой страницы Progress;
один actor-scoped запрос возвращает все рекорды выбранного workout.

## Acceptance checklist

1. Заменить загрузку workout + N страниц упражнений одним GET
   `/v1/workouts/:workoutId/personal-records`. Доменный WorkoutPersonalRecord
   сохраняется; отсутствие рекордов возвращает [], ошибка допускает retry,
   без Supabase fallback и обхода ошибок.
2. Numbered Yandex migration считает рекорды по подтверждённым подходам done
   workout относительно только предшествующей завершённой истории клиента.
   Первый результат и равенство не рекорды. Strength: weight/weight_reps;
   остальные виды: primary. Для volume вес/повторы принадлежат лучшему volume
   подходу. Повтор одного ref агрегируется; порядок — упражнения/метрики.
3. Существующий can_read_workout защищает target, включая author/membership,
   удалённые и чужие workouts. История сравнения общая, как текущий Progress.
   PUBLIC execute запрещён; fit_api получает только execute. Нет mutations,
   новых таблиц, индексов, grants на данные, Supabase migrations/media changes.
4. Регрессия: старый record workout после ≥21 новых результатов возвращается,
   несмотря на отсутствие его в первой странице. Проверить типы метрик,
   ties/first/unconfirmed/deleted, дубли refs, tenant/author access и grants.
   API/session/invalid/error, repository один запрос/validation/retry, clean
   PostgreSQL17/actor-RLS, local:verify и npm run check обязательны.

## Границы и проверка

Внешний вид, тексты, навигация, главные страницы, формулы Progress/achievements,
ИИ, SpeechKit, legacy recovery/media не меняются. Существующие компоненты
истории используют прежний доменный контракт; новых действий/токенов нет.
Визуальный redesign и удалённый Preview не входят в scope.
Высококонфликтные файлы: migration numbering, app.ts, actor integration,
yandex-main.repository, CURRENT_STATE. Перед merge — очередь ранних PR,
обновление main и повторный CI. Tracker connector недоступен.

## Выполненные проверки

- Regression-first repository tests упали на прежнем workout+page пути;
  после замены repository/completion/summary85/85, API3/3 passed.
- Actor115/115: old workout после21 новых, strength weight/volume разными
  подходами, duplicate ref, reps/duration/distance, first/tie/deleted/unconfirmed,
  completedAt/UUID tie-break, planned target, client/author/outsider, shared
  history, grants, реальная app-session/revocation и transactional down/up.
- local:verify блокирован прежней legacy migration20260919145000; общая БД
  не сбрасывалась. WebKit legacy review остановился на входе в локальный
  Supabase до открытия workout; это не проверка нового Yandex-контракта.
- Migration134:132/133 уже заняты ранним активным PR#1493. Перед выпуском
  требуется новый main и обязательный CI. После обновления от main62a92c46
  clean PostgreSQL17 chain134/actor115/115 и полный npm run check passed:
  lint/typecheck/coverage, API1204/1204, policy/hosting/build/startup verification.
- Реальный `/workouts/:id` на WebKit с Yandex-only flags и синтетическим
  app-session/API: старый workout показывает 60кг×10, один records запрос,
  ноль Progress pages/Supabase calls, нет overflow390/430; 1/1 passed.
  Проверка нового transport не опирается на старый Supabase login.
- PR#1495: полный CI37626195696 и Android37626195719 на6ca70e74 success.
  После merge#1491 ветка обновлена от main628b495c: полный npm run check,
  API1204/1204, WebKit1/1 и свежая чистая PostgreSQL17 chain134/actor115/115
  повторно passed. Повтор actor suite на ранее использованной тестовой БД
  дал113/115: истёкшие строки предыдущего запуска меняли глобальный batch
  cleanup и план индекса. Пересоздан только собственный временный контейнер;
  общая legacy-БД не менялась, тесты не ослаблялись.
- Exact-head CI37629455480/Android37629455419 на8d2c91b9 success.
  После merge#1493/#1494/#1497 ветка повторно обновляется от mainfca6cb75.
  Git-конфликт snapshot разрешён с сохранением обеих сторон; API/repository
  и их тесты объединены без удаления соседних изменений. Обнаружена также
  коллизия номера134 с уже слитой migration шаблонов: только собственная
  невыпущенная migration рекордов перенумерована136, включая Down/Up test.
  Миграции134/135 в main не переписываются. Fresh clean PostgreSQL17
  chain136/actor125/125, WebKit Yandex records1/1 и полный npm run check
  (frontend2514/API1205/lint/typecheck/policy/build/startup) passed.
  Migration safety check против origin/main passed, конфликтных маркеров нет.
  local:verify повторно ограничен прежней missing legacy migration20260919145000;
  общая БД сохранена. Exact-head CI нового merge ещё гейт; PR не сливался,
  production этого PR не менялся.
- iOS/simulator не проверен: Xcode/simctl в текущем окружении отсутствуют.
  Android debug CI зелёный; физическое устройство и реальный OAuth не проверены.
