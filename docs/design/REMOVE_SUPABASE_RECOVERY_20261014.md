# Удаление legacy password recovery — 14.10.2026

Решение владельца: «уже много времени прошло, кто хотел, те вернулись; давай убирать».
Scope: identity-runtime. Исходная база: origin/main 0aeb0c42; ветка обновлена от maince335e59; одна ветка/PR.

1. Удалить выбор старого аккаунта и email/password recovery. Неизвестный Yandex ID
   после PKCE сразу открывает существующую YandexRegistrationForm. Единственная
   primary CTA — «Создать аккаунт»; «Назад» отменяет регистрацию и возвращает на вход.
2. Удалить клиентские recovery query/repository и серверный endpoint, credentials
   provider/password grant, runtime recoverExisting/attempt tracking. Устаревший
   POST получает 404 и не создаёт аккаунт.
3. Сохранить вход связанных identity, explicit native registration, роли,
   приглашения, legal acceptance, handoff expiry/single-use и транзакции.
4. Проверить validation, длинное имя, pending/disabled/no-double-submit, error/retry,
   expired confirmation, cancel, роли и invitation client-only. WebKit обе темы
   390/430 и trainer1440; актуальный маршрут и принятая registration form — референс.
5. Обновить product wiki, parity, cutover/operations и rolling snapshot. Выполнить
   целевые frontend/API проверки и полный npm run check; передать PR с зелёным CI.

Компоненты/токены: YandexRegistrationForm, ClientLimeStandaloneLayout, Field,
FitLogo, BackIcon/CheckIcon; текущие Lime form/primary/safe-area tokens.
Добавлена pointerdown-защита submit, как в текущих Fit finance forms: blur
фото не смещает кнопку до click (до исправления WebKit6/6 воспроизводили дефект). CSS,
провайдер данных, prompt/LLM/SpeechKit, media, push и DB schema вне scope.
Непривязанный старый профиль больше не восстановится этим способом — принятое
продуктовое ограничение. Данные/SQL migration history остаются нетронутыми.
Исполняемые recovery DB tests удаляются вместе с удалёнными runtime methods;
остальные linked-login/native-registration actor/RLS проверки сохраняются.

## Приёмка

| Пункт | Проверка | Статус |
| --- | --- | --- |
| 1 | Route WebKit обе темы390/430/1440, отсутствие recovery | Локально passed |
| 2 | API404, no handoff/registration calls; поиск удалённых symbols | Целевые API passed |
| 3 | Linked/native/invitation contracts | Целевые frontend/API passed |
| 4 | Component и route matrix | Component и WebKit passed |
| 5 | Документация, полный check, CI/PR | Check passed; CI/PR впереди |

Production не проверен; Supabase проект/секреты не изменялись.

Локально: targeted frontend76/API261 passed, финальный npm run check exit0
(frontend2660/API1385+155 DB-skipped/infra270/hosting137/build). Schema не меняется:
local:verify/clean-chain не запускались; существующий actor/RLS набор проверяет CI.
WebKit registration6/6 passed после воспроизведения blur6/6. Общий auth:16/17 passed
с конфигурацией CI и1/1 точечный повтор light430 (локальный timeout на fill имени,
исходный прогон сохранён, assertions/retries/timeouts не менялись). Предыдущий
общий прогон без CLIENT_LIME switch:16/17, конфигурация исправлена. Шрифты2/2
проверены штатным WOFF2/SHA256 validator; light430/dark390 просмотрены.
Screenshots: test-results/yandex-only-auth.webkit-Li-*/registration-*.png.
Первый check остановился только на unused import удалённого DB recovery test;
он удалён, полный check повторён успешно. Мобильные production bundles и реальный
OAuth не проверены; rollout/API+frontend/native остаются отдельным уровнем.

После синхронизации с maince335e59: API check1387 passed/156 skipped и
infra:policy271/271 passed. Изменения main — отдельный Cloud.ru push CLI, его
tests/workflow и e2e-scope; frontend/runtime auth не менялись.
