# Fit — текущее состояние проекта

> Rolling snapshot для продолжения между сессиями. Максимум 120 строк.
> После каждого подтверждённого merge заменяйте сведения ниже, не добавляйте
> хронологию: полная история уже хранится в Git и Tracker.

Обновлено: 2026-08-17
Проверенный `main`: `6382ab2` (`docs: record YAFIT-305 merge (#406)`)

## Активная работа

- Активная задача миграции: выполнить первый отдельно одобренный stage deploy
  по `docs/STAGE_DEPLOYMENT.md`, проверить private API, PostgreSQL и миграции.
- Следующий этап после успешного stage smoke: Yandex ID/profile vertical slice
  и серверная tenant-allowlist для read-only пилота.

## Последняя проверенная продуктовая точка

- После `#405` переключатель `км`/`м` читается на iPhone; после `#403` служебные
  подписи quick review не перекрывают беговые поля.
- После `#401` непрерывный бег хранит длительность и дистанцию, рассчитывает
  темп и одинаково отображается в плане, live, истории и копировании. GPS,
  интервалы и голосовой ввод бега ещё не реализованы.
- После `#399` workout-domain снова использует `updated_by`, а live/progress
  RPC явно передают actor ID. Аналитика последней активности учитывает того,
  кто действительно изменил запись.
- Progress использует goal-aware LLM-сводку, confirmed-only прогресс упражнений,
  реальные PR, cursor-пагинацию и план/факт за неделю или месяц в timezone
  клиента.
- Client Home сохраняет voice-first первым действием, показывает следующую
  тренировку, завершённые тренировки и один релевантный акцент.
- История тренировок показывает спортивную хронику: упражнения, подтверждённый
  факт, длительность или тоннаж, RPE, wellbeing, PR, комментарий клиента и
  ответ тренера.
- Клиент может идемпотентно отправить session RPE, wellbeing и дискомфорт;
  ответственный тренер — реакцию и короткий ответ. Cross-tenant доступ закрыт.
- Live-workout сериализует корневые изменения, использует последнюю version и
  сохраняет неподтверждённый факт при конфликте или сетевой неопределённости.
- Календарные границы Today, расписания, целей и прогресса считаются по IANA
  timezone профиля; legacy fallback — `Europe/Moscow`.
- Тренер и клиент используют общий workout domain; один active workout на
  клиента защищён UI и БД, назначения и факт видимы обеим сторонам по ролям.
- Fastify/Yandex Cloud foundation, Terraform и отдельная PostgreSQL migration
  chain существуют изолированно. Production frontend использует Supabase;
  `terraform apply` не запускался, платные ресурсы не создавались.

## Влияние нового main на миграцию

- План первого private stage deploy не меняется: он проверяет инфраструктуру,
  TLS/readiness и уже подготовленные migrations `000001`–`000003`.
- После auth/profile необходимо отдельно перенести новые контракты из `main`:
  timezone, `updated_by`/version, feedback, trainer response/reactions,
  regularity, exercise progress/PR, workout chronicle, run metrics, realtime и
  goal-aware summary.
- Supabase migrations не копируются напрямую. Каждый контракт переносится
  отдельным dependency-ordered PostgreSQL-срезом с RLS/cross-tenant тестами.
- Безопасная единица production rollout — связанная tenant-когорта. Dual-write
  запрещён; переключение выполняется только после полной миграции её mutable
  данных.

## Последние проверки

- `#405` / `YAFIT-305`: GitHub CI app/database/e2e и Vercel прошли; локально
  полный `npm run check`, WebKit 390 px и visual profiles зелёные.
- `#403` / `YAFIT-304`: `npm run check` — 432 теста приложения и 10 API-тестов;
  quick review и клиентский сценарий бега проверены на WebKit 390 px.
- `#401` / `YAFIT-300`: `npm run check` — 432 теста приложения и 10 API-тестов;
  полный пользовательский сценарий и visual profiles прошли.
- `#399` / `YAFIT-299`: `npm run db:reset` + `db:test` — 503/503 SQL/RLS;
  DB types, lint, typecheck и build зелёные.
- `#379`: 377 frontend- и 10 API-тестов; Terraform `fmt`/`validate`, Podman
  image smoke и PostgreSQL 17 migration E2E прошли.

## Ближайший migration roadmap

1. Первый private stage deploy и smoke.
2. Yandex ID, profile slice и серверная tenant-allowlist.
3. Read-only пилот на внутренних/синтетических аккаунтах.
4. Dependency-ordered перенос актуального workout-domain.
5. Две полные tenant migration rehearsal и постепенный cohort rollout.

## Отложенный продуктовый backlog

- `YAFIT-301` — интервалы, восстановление и СБУ.
- `YAFIT-302` — беговой прогресс: километраж, длительность, темп и RPE.
- `YAFIT-303` — текстовые и голосовые сценарии бегового ввода.
- `YAFIT-290` — список «Кому нужно внимание» для тренера.
- `YAFIT-245` не начинать без отдельного разрешения пользователя.
- `YAFIT-234` отложен; SpeechKit relay не менять. Webvisor сохранён осознанно.

## Постоянные ограничения

- LLM-разбор и SpeechKit не менять без отдельного продуктового решения.
- UI проверяется на Client 390/430 px и Trainer 1440 px; для мобильных
  сценариев обязателен WebKit.
- Локальные Supabase-проверки работают через Podman; production URL и секреты
  не читаются и не используются.
- Backlog и статусы подтверждаются через YAFIT; этот файл — индекс, не замена
  Tracker.
