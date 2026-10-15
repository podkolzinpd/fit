# YAFIT-610 — тёмный первый экран Fit Lime

## Исходный запрос владельца

> проверь, это точно работает? я выходил из приложения и оно снова с белым фоном
>
> и у нас самый первый экран остался белый - где написано использоватья яндекс айди, а нужно чтобы был черным с этой девушкой на заставке

## Неизменяемый acceptance-план

1. Первый Yandex-only /auth — тёмный существующий Fit Lime с исходным фото заставки, FitLogo, YS Geo400/500 и одним primary «Продолжить с Yandex ID». Без новых палитр/шрифтов.
2. Сохранять тёмный entry при холодном старте, logout, reload и повторном открытии. Не записывать тёмную тему поверх настроек клиента/тренера; registration/legal/legacy paths не перекрашивать глобально.
3. Сохранить OAuth/PKCE, pending/disabled, error/retry, приглашения и legal links; фото не блокирует вход при ошибке. API/сессии/данные/LLM/SpeechKit без изменений.
4. Проверить реальный маршрут WebKit/Chromium390/430 и shared1440, обе системные/сохранённые темы, повторное открытие и logout, отсутствие overflow, focus/touch/safe area. Полный check, зелёный CI; штатный PR/production/native по постоянному разрешению владельца и AGENTS.md. Не выдавать симулятор за физический iPhone.

## Подтверждённая причина и эталон

Baseline main5533bee7; ветка обновлена от main7f0392d4 (#1640, native composition); публичный /auth15.10 воспроизведён Playwright WebKit390: `auth-flow-identity theme-light`, фон `rgb(251,250,247)`, Onest, фото отсутствует. [До](auth-lime-entry-20261015/before-public-390.png).

#1557 перенёс только new-account registration. Первый экран использовал AuthIdentityScreen/useAppTheme, а внешний ClientLimeStandaloneLayout без actor не включал Lime. Это реальный отдельный незавершённый экран, а не доказанный сбой хранения темы или кэша.

Эталон — существующие StartupSplash и YandexRegistrationForm. Фото /assets/startup-photo-983c93dc4df8.jpg, FitLogo, существующая primary, --lime-bg/--lime-text/--lime-accent/--lime-radius-card и licensed YS Geo400/500. Последний прямой запрос владельца о тёмном Lime приоритетнее исторического Mono-контракта документации.

Узкое расширение ClientLimeStandaloneLayout: authEntry до actor, фиксированный dark только на первом Yandex-only /auth, без записи в localStorage и без расширения клиентского server gate на другие публичные страницы. Остальные auth/API/PKCE/native redirect/права без изменения. Сохранены приглашение, pending/disabled/error/retry и юридические ссылки. Удалено только дублирующее пояснение о способе входа; сама кнопка названа прежним именем.

## Матрица приёмки

| Пункт | Видимый результат | Доказательство | Статус |
| --- | --- | --- | --- |
| 1 | Чёрный экран, фото, белый логотип, YS Geo и один Lime CTA | WebKit8/8 + Chromium8/8 после main7f0392d4; after-снимки | Локально проверено |
| 2 | Повторное открытие/reload/logout сохраняют dark entry и отдельные настройки аккаунта | Entry e2e cold/reload/new tab/logout + unit remount | Локально проверено |
| 3 | Фото fallback, ошибки PKCE/session, retry, pending, invitation/legal | Auth unit31 и прежний Yandex-only spec | Unit31/31, WebKit/Chromium8/8; регистрация6/6 (light430 после load-timeout повторена1/1) |
| 4 | 390/430/1440, light/dark preferences, overflow/focus/48px; check/CI/production/native | Логи и ссылки выпуска | Browser проверен; полный check passed2697frontend/1418API+159DBskip; CI/production/native впереди |

Реальные аккаунты/пользовательские данные не изменяются; локальные API ответами fixture изолированы. Физический iPhone и реальный OAuth callback не подменяются WebKit/симулятором.

## Локальные проверки и ограничения

Новый entry до и после merge main7f0392d4 прошёл обе системные/сохранённые темы390/430/1440, reload/new tab, account logout, сохранность темы аккаунта, image fallback, PKCE pending/error/retry, 48px/pill/font/focus и legal navigation: WebKit8/8 и Chromium8/8. DOMContentLoaded с отдельным ожиданием реальной формы/фото/шрифтов заменяет ожидание стороннего window.load; лимиты и UI assertions не уменьшаются. Исходный Yandex-only entry smoke2viewports также прошёл. Предыдущий общий auth lane24/25, единственный navigation load timeout light430 — целевой повтор1/1. Фикстура logout включает health с x-fit-request-id для существующего защищённого DELETE; продуктовый logout/API не менялся.

Полный check на5533bee7: frontend2682/2682 и coverage прошли после двух неизменённых ExercisePicker5s-timeout (target59/59); API остановился на отсутствующих локальных fastify/pg/types зависимостях. Совпадающий lock не доказывал полноту старого node_modules. Зависимости установлены отдельно в worktree, API typecheck прошёл; после main7f0392d4 полный check запускается заново с4Vitest workers без изменения timeout/assertions/coverage.

Полный check после main7f0392d4 прошёл exit0:305 frontend files/2697tests,122 API files/1418tests+159DBskip, coverage82.86/77.01/82.81/87.24, lint/typecheck/policies/hosting/build/startup guard passed. После этого допускается только подтверждённый narrow CSS semantic fix (--danger вместо отсутствующего --danger-fg) с целевым WebKit/Chromium color assertion; source/API handlers не меняются. Сборка БД не меняет.

Ветка сведена с maina0551525 (#1650–1652: только Cloud.ru backup/speech/media tooling и API operational helpers). UI/source diff относительно main7f0392d4 с ранее зелёным check неизменён, кроме указанной CSS semantic-правки. Обновлённые infra tests16/16 и API cloudru-backup11/11 passed. Приёмка error color после CSS fix: WebKit1/1; Chromium выполняется.

## Exact-head CI38777803845: согласование с новым публичным экраном

Auth lane:33passed, один новый logout fixture остановлен существующим client-assistant Coachmark до нажатия «Выйти». Fixture теперь представляет возвращающегося спортсмена: записан только existing `client-assistant-2026-09` в `fit.coachmarks-seen.<synthetic-id>`, как в shared mockPilot. Обычный click, DELETE readback, settings storage assertions, timeout/retries сохранены. Локальный последовательный повтор3/3 passed.

Три Lime jobs выявили два прежних logout-ожидания «любой Lime shell должен исчезнуть». По прямому запросу владельца теперь существует анонимный dark Lime entry. Проверки заменены на: старый authenticated shell/страница настроек отсутствуют; публичный entry видим и чёрный; non-pilot аккаунт не наследует Lime; собственный theme preference при возврате сохраняется. Все остальные publication/confirmation/role/theme assertions сохранены. Два сценария в обоих движках4/4 passed. Product/auth/theme source не менялся при этой корректировке.

Protected inventory проверен явно: baseline4c66c8e2… совпал с HEAD,238 callbacks/236byte-identical, изменены только два перечисленных logout callbacks, helper fixtures byte-identical. Политика и разбиение21/21 passed, union624cases/engine без повторов прежний. Защищённый reviewed digest4c66c8e2… оставлен без изменения: автоматический approval review отклонил изменение этого CI metadata. При изменённом spec guard штатно выбирает full acceptance; сокращённый feature-only набор до отдельного одобренного обновления inventory не применяется. Allowlist/expiry/runner/assertions/timeouts/CI gates не ослаблены. Это безопасный fail-closed путь, без обхода отклонения.
