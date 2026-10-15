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

Baseline main5533bee7; публичный /auth15.10 воспроизведён Playwright WebKit390: `auth-flow-identity theme-light`, фон `rgb(251,250,247)`, Onest, фото отсутствует. [До](auth-lime-entry-20261015/before-public-390.png).

#1557 перенёс только new-account registration. Первый экран использовал AuthIdentityScreen/useAppTheme, а внешний ClientLimeStandaloneLayout без actor не включал Lime. Это реальный отдельный незавершённый экран, а не доказанный сбой хранения темы или кэша.

Эталон — существующие StartupSplash и YandexRegistrationForm. Фото /assets/startup-photo-983c93dc4df8.jpg, FitLogo, существующая primary, --lime-bg/--lime-text/--lime-accent/--lime-radius-card и licensed YS Geo400/500. Последний прямой запрос владельца о тёмном Lime приоритетнее исторического Mono-контракта документации.

Узкое расширение ClientLimeStandaloneLayout: authEntry до actor, фиксированный dark только на первом Yandex-only /auth, без записи в localStorage и без расширения клиентского server gate на другие публичные страницы. Остальные auth/API/PKCE/native redirect/права без изменения. Сохранены приглашение, pending/disabled/error/retry и юридические ссылки. Удалено только дублирующее пояснение о способе входа; сама кнопка названа прежним именем.

## Матрица приёмки

| Пункт | Видимый результат | Доказательство | Статус |
| --- | --- | --- | --- |
| 1 | Чёрный экран, фото, белый логотип, YS Geo и один Lime CTA | WebKit/Chromium, after-снимки | Проверка выполняется |
| 2 | Повторное открытие/reload/logout сохраняют dark entry и отдельные настройки аккаунта | Entry e2e, unit remount | Проверка выполняется |
| 3 | Фото fallback, ошибки PKCE/session, retry, pending, invitation/legal | Auth unit31 и прежний Yandex-only spec | Unit31/31; e2e выполняется |
| 4 | 390/430/1440, light/dark preferences, overflow/focus/48px; check/CI/production/native | Логи и ссылки выпуска | Выполняется |

Реальные аккаунты/пользовательские данные не изменяются; локальные API ответами fixture изолированы. Физический iPhone и реальный OAuth callback не подменяются WebKit/симулятором.
