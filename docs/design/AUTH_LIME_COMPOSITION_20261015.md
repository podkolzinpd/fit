# YAFIT-612 — Первый экран входа — композиция фотографии и приветствия

## Запрос и согласованный план

Владелец после #1654 показал фактический экран: фотография выглядит обрезанной,
отдельный логотип занимает верх, приветствие оторвано пустым промежутком и
слишком прижато вниз. Подтвердил: «Окей, фиксируй план, делай, выкатывай всё полностью».

Неизменяемый acceptance-чеклист из согласованного предложения:

1. **Убрать отдельный логотип сверху.**
2. **Поднять фотографию**, показать гантель, руку и больше фигуры. Чёрные края исходника объединить с фоном, убрать ощущение прямоугольной карточки.
3. **Разместить приветствие ближе к фотографии**, примерно в нижней трети экрана, без огромного пустого разрыва.
4. Заголовок — **«Добро пожаловать в ФИТ»**. Фирменный знак можно использовать вместо слова «ФИТ» в этом блоке, без повторения наверху.
5. Ниже оставить короткую подпись, одну лаймовую кнопку Yandex ID и юридические ссылки.

## Границы и эталон

Поток product; baseline main48da5797 после #1654/#1655, отдельная ветка
fix/auth-lime-composition-20261015. Scope — только первый Yandex-only `/auth`.
Референс: опубликованный dark Lime entry #1654 и исходная фотография StartupSplash
`/assets/startup-photo-983c93dc4df8.jpg`940×1673. Исходник уже без лица; новую
картинку не генерируем и не дорисовываем. Проверка KB не дала контекст из-за
двух ошибок зарегистрированных materializations; реестр/KB не изменяем.

Переиспользуем FitLogo, YS Geo400/500, --lime-bg/--lime-text/--lime-text-secondary,
существующий primary48px/pill и danger для настоящей ошибки. Только композиция
и подтверждённый заголовок; OAuth/PKCE, pending/disabled, session retry,
приглашения, legal destinations, fixed dark entry и account preferences остаются.
Никаких API/БД/флагов/LLM/SpeechKit, редизайна регистрации или тренерских экранов.

Причина: `.lime-auth-photo` использует cover в контейнере42dvh, отдельно от
логотипа112×60; `.lime-auth-actions` имеет margin-top:auto. Общий immersive shell
также резервирует нижнюю панель и safe-area margin, которых у public entry нет.
Любое устранение этого резерва ограничиваем content, содержащим `.lime-auth-entry`.

## Проверка и выпуск

Обычный вход, обе сохранённые/системные темы390/430/1440, узкий/короткий экран,
safe-area, полностью видимое фото без дополнительного crop, единственный знак
в heading, расстояние фото→heading, focus/touch/overflow/CTA/legal;
приглашение, pending/disabled, ошибка PKCE/session и retry, недоступное фото,
logout, reload/new tab/full restart без перезаписи темы. Состояние успеха —
существующий OAuth transition; реальный чужой аккаунт не используем.
Расширяем assertions существующего entry e2e, не размножаем матрицу длинных
logout-сценариев и не меняем protected CI inventory/таймауты/assertions.
Полный check, зелёный exact-head CI, штатный merge/Cloud.ru и public readback;
после merge свежий native bundle/iOS build/install/launch. Store/реальный OAuth
и физический iPhone не выдаются за проверенные.

| Пункт | Видимый результат | Доказательство | Статус |
| --- | --- | --- | --- |
| 1 | Один знак, внутри приветствия | [390](auth-lime-composition-20261015/after-390.png), existing unit31/31/DOM | Локально проверено |
| 2 | Фото выше, полный исходник в contain без рамки/скругления | [До](auth-lime-composition-20261015/before-390.png), [после430](auth-lime-composition-20261015/after-430.png), contain/radius assertions | Локально проверено |
| 3 | Связанные фото и heading, CTA выше края | Gap16–32px, core390/430, [short360](auth-lime-composition-20261015/short-360.png); native safe area после merge | Browser проверен; native впереди |
| 4 | Один доступный heading «Добро пожаловать в ФИТ» | Unit31/31, WebKit8/8, Chromium8/8 | Локально проверено |
| 5 | Подпись, один primary, legal и реальные ошибки | Existing entry e2e, [error/photo fallback](auth-lime-composition-20261015/error-no-photo.png), [pending](auth-lime-composition-20261015/pending.png) | Локально проверено |

## Фактура локальной приёмки

Unit31/31; entry WebKit8/8 (27.7s), Chromium8/8 (30.3s). Дополнены assertions существующих6 entry-view cases: один знак в heading, contain/no radius, gap16–32px, видимый CTA. Только в light390 проверяются два коротких viewport375×667/360×568; число тестов/полных logout flows не увеличено. Эти assertions обнаруживают именно повторную обрезку/дублирование/разрыв/вытеснение CTA. До правки старый entry suite занимал WebKit1.1m/Chromium43.6s на production; это другой backend/сеть, прямого сравнения длительности нет. Локальные browser screenshots просмотрены; без фото остаются заголовок, CTA/error и legal.

Первый локальный browser запуск остановлен: порт5198 уже занят чужим процессом, Vite перешёл5199. Чужой процесс не менялся, приёмка повторена на собственном5216 с strictPort. Chromium config исправлен на абсолютный путь к существующему runtime; продукт/лимиты/проверки не менялись. Полный check и выпуск — отдельные обязательные гейты, пока выполняются.

Все стадии npm run check локально прошли: lint/typecheck/frontend2697/305files, coverage82.87/77.01/82.83/87.24, DB-types/iOS permissions/media; infra/calendar/hosting169/API1418+159DBskip/build/startup. Единый запуск остановился только на loopback EPERM в unchanged speech relay fixtures; оставшийся стандартный хвост повторён с доступом к локальным портам и завершился exit0. Таймауты/thresholds/skip/gates не менялись.

Перед PR включён mained7969d3 (#1656, только API background timeout/transaction tooling). Собственный frontend/e2e/build-config diff относительно проверенного f1746374 пуст; новые upstream API tests3files/18cases прошли. Protected CI fingerprint и конфигурация не менялись.
