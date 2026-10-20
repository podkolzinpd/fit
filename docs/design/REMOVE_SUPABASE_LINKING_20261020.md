# Удаление Supabase-based linking

База: main b43ec0ea. Поток: identity-runtime. Отдельная ветка
codex/remove-supabase-linking. Открытый более ранний PR: #1726 (Android OTA).
Tracker connector в этой сессии не использовался; план хранится здесь.

## Подтверждённая постановка

Давай уберем Supabase-based linking целиком: UI, transport и серверные обработчики. Существующие привязки и вход через Yandex ID сохраняем. И дождись зеленого CI.

## Preflight

| Уже работает | Сохраняем | Действительно меняем | Проверка |
| --- | --- | --- | --- |
| Native Yandex login/registration | PKCE, app-session, identities, invitation return | Retire Supabase linking endpoint/provider | API auth contracts / HTTP404 |
| Вход обеих ролей | Текущие главные и их primary actions | Только удаление linking card и gate | Native auth browser suite, client/trainer fixtures |
| Незавершённый callback | Общий error/retry экран | Старый intent очищается без OAuth exchange | Unit/component/browser |
| Frozen SQL/RLS | Прежние security/idempotency assertions | Legacy SQL fixture локален integration test | PostgreSQL CI gate |

Baseline: WebKit real /auth,390/430 и dark screenshot — 1 test passed до
изменений. Переиспользуются AuthIdentityScreen/StatePanel/Link, существующие
Lime стили и токены. Primary остаётся «Продолжить с Yandex ID». Нет новых
экранов, токенов, флагов, SQL migrations или изменения rollout.

## Неизменяемая приёмка

1. Linking UI, gate, callback flow и его flags удалены; соседние действия прежние.
2. Linking query/repository DTO и transport удалены.
3. HTTP GET/POST /v1/auth/yandex/link возвращают404, production linker/provider удалены.
4. Существующие identities и native login/session/registration/invitations сохранены.
5. Целевые проверки, полный check и CI зелёные до передачи PR.

## Проверки и соответствие покрытия

- Старые card/gate/callback/flag tests и gate-only E2E/visual проверяли намеренно
  удалённую функцию; удалены вместе с неиспользуемыми тремя baseline images.
- Linking HTTP happy/conflict/outage cases заменены retirement404 assertions
  с/без Supabase token и запретом OAuth exchange.
- Старый OAuth intent link positive case заменён stale-callback rejection/clear.
- SQL RLS/idempotency/bootstrap assertions не удалены: прежний fixture-adapter
  перемещён внутрь actor-context integration suite. Выпускаемый API его не импортирует.
- Все native auth/session/registration tests сохранены. Native browser suite
  дополнительно запрещает обращения к retired linking endpoint во всех сценариях.
- Новые случаи: OAuth unit (один), callback component (один), WebKit callback
  (один), API404 (один test,4 method/auth combinations). Они проверяют разные
  границы: storage clearing, UI retry/no repository call, real route/no HTTP,
  серверное отсутствие endpoint. Темы/размеры не размножают новые сценарии.
- Targeted frontend137/137 и API252/252 passed; API typecheck passed.
- WebKit native auth:31/31, включая роли/registration/invitations/restore и
  retired callback; старые linking flags=true не возвращают сценарий.
- Auth entry390/430/dark screenshots побайтно равны baseline;13 остальных
  auth functions runtime-equivalent. Выпускаемые frontend/API не содержат
  /v1/auth/yandex/link.
- Полный check exit0: frontend2755, API1446+184conditional integration/DBskip,
  infra332/calendar12/hosting170/lint/typecheck/API build/frontend build/startup passed.
- Полный CI: ожидается в PR. Production не менялся. Реальный OAuth
  и физическое устройство не проверялись. Timings before/after полного CI нет.
