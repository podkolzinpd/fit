28.10 — Чат: плашка даты перед первым сообщением дня («Сегодня», «Вчера», «26 октября», «12 марта 2025»), раньше «Новые сообщения»; в списке чатов дата по давности. День по часам телефона. chat-dates.ts + тесты.
# Fit — текущий индекс
04.11 — [Профиль клиента:3PR/COP](design/CLIENT_OWN_PROFILE_20261104.md).
08.11 — [17 журналов](design/ATHLETE_PROGRAM_HISTORY_IMPORT_20261103.md):17/17; связь и доступ — итерации30–31.
YAFIT-701: [R101–R106, восстановление карточки у тренера без изменения истории](https://st.yandex-team.ru/YAFIT-701).
Шаблоны: [TMPA/R01–R04](design/COACH_WORKFLOW_AUDIT_20261031.md);1957 принят.
02.11 — CI: production-mode browser набор873 разделяется на4 части без сокращения;
[план, сохранность и исправления flaky swipe/video](design/PRODUCTION_BROWSER_CI_SHARDS_20261102.md). CI нового head ещё гейт.
TC101–107: [план/статус](design/TRAINER_CONNECTION_CONFIRMATION_20261102.md). В работе.
[Supabase: native restore merged; pilot cleanup](design/SUPABASE_DECOMMISSION_PLAN_20261023.md).
Live: [LC101–304,3PR](design/LIVE_SINGLE_ACTIVE_CARD_20261104.md); [выпуск](https://github.com/podkolzinpd/fit/pull/1972).
YAFIT-699: компактный список клиентов и гостевое приглашение,2PR. [План/проверки](design/COACH_CLIENTS_AND_INVITATION_20261031.md); [статус выпуска](https://st.yandex-team.ru/YAFIT-699).
ФИТ20: [все статусы R104-S](design/COACH_RESCHEDULE_AND_DAY_GESTURES_20261031.md), [PR1923: CI](https://github.com/podkolzinpd/fit/pull/1923); [F201–208: CI/выпуск](design/COACH_WORKFLOW_AUDIT_20261031.md).
YAFIT-698/WQ101–105: проведение и обновление очереди после сохранения. [План](design/COACH_QUICK_COMPLETION_20261031.md); [статус](https://st.yandex-team.ru/YAFIT-698).
YAFIT-700: [Статусы тренера](design/COACH_WORKOUT_STATUS_DISPLAY_20261101.md), [статус](https://st.yandex-team.ru/YAFIT-700).
31.10 — YAFIT-697: время быстрого старта обеим ролям, проведение пустой записи
и «Не состоялась» тренеру. [План, проверки и выпуск](design/COACH_ATTENDANCE_AND_START_TIME_20261031.md).
PR1906–1908 опубликованы db96685e; итог в YAFIT-697.
MC4.2/MC4.3 приняты. MC4.4/PR2051: выпуск первым разрешён; обновление main по branch protection. [План/проверки](design/CLIENT_REFERENCE_SCREENS_20261029.md), §180–186.
30.10 — YAFIT-695 завершён: компактная история у тренера опубликована PR1892/cccecf35. [H101–H107, журнал и production-приёмка](https://st.yandex-team.ru/YAFIT-695).
29.10 — YAFIT-673: полный список упражнений выбранного дня у тренера, записанные факты под названиями; обычный список/клиентский календарь прежние. План и статус выпуска: [каноническая запись](design/COACH_CALENDAR_FULL_EXERCISES_20261029.md). Локальные целевые/браузерные проверки пройдены, полный check/CI/production ещё гейты.
Исходная база документа: main203f539d21fbc5cf79b1c930dc8467bbc8dc5c3b,28.10.2026; это не автоматически текущая production-сборка. Перед работой сверить main, нужный тикет и фактический выпуск.

## Анкеты тренеров / YAFIT-674

Утверждены четыре последовательных PR с публикацией.
[Канонический план и журнал](design/TRAINER_PROFILES_OFFICES_20261029.md).
P1/PR1866 опубликован на37929456; файлы/health и реальный frontend3/3 проверены.
P2/PR1880 опубликован на7d061bc5; файлы/health и реальный frontend2/2 проверены.
P3/PR1881 опубликован наf847f25b:213 файлов/health и кабинет7/7 проверены.
P4/PR1882 опубликован наe5b5aa1d:213 файлов/health и public UI3/3 проверены.
P1–P4 завершены; итог — итерация26 канонического журнала и YAFIT-674.
31.10 справочник заполнен:32 офиса добавлены,33/33 после reload; итерация27.
02.11: [кабинет Яндекса](design/CORPORATE_ADMIN_20261027.md): PR1930/1937 опубликованы.
SRV/ADM/CPT приняты, personal test ON. DUT:PR1/2050 принят; PR2/2054 main4aa локально включён, CI; duty OFF, журнал79.

## Точка продолжения
[UX:4PR, проверки](design/WORKOUT_LIFECYCLE_UX_AUDIT_20261101.md).
YAFIT-696: стабильная клавиатура и упражнения первыми — всем тренерам.
[План и журнал](design/COACH_EXERCISE_FIRST_AND_KEYBOARD_20261030.md); текущие CI,
слияния и опубликованная версия — [в задаче](https://st.yandex-team.ru/YAFIT-696).
Общая клавиатура обеим ролям; клиентский дизайн и механика сохраняются.

Удаление одной согласованной учётки: [план и журнал](design/ACCOUNT_DELETION_PROCESS_20261029.md).
31.10 удалено и проверено; секрет/квитанция/автоматизация очищены.

YAFIT-692: общий выпуск quick-entry и названия тренировок обеим ролям,4PR.
[Канонический план](design/WORKOUT_NAMES_AND_PUBLIC_QUICK_ENTRY_20261030.md); статус/выпуск — [задача](https://st.yandex-team.ru/YAFIT-692).
Прежняя fixed2-граница этого пакета заменена решением владельца30.10.

YAFIT-675:5 PR — прошлые значения quick Live, каталог/поиск, быстрая запись Day
и история в той же записи; исходный пилот был ограничен двумя учётками.
[План и проверки](design/QUICK_WORKOUT_AND_BOOKING_PLAN_20261029.md).
Расширение этого пакета всем согласовано в YAFIT-692 выше; прочие пилоты прежние.

YAFIT-672: принятие нового документа правил одним PR для всех экранов/ролей.
[PR1859](https://github.com/podkolzinpd/fit/pull/1859); статус выполнения —
[в задаче](https://st.yandex-team.ru/YAFIT-672), без второй копии журнала.
[План и соответствие разделов](design/AGENT_RULES_ADOPTION_20261028.md).
AGENTS — основные правила; FIT_WORKFLOW — карта контекста и записей без DEVLOG.
Действующие знания и история сохранены; runtime/флаги/механики не меняются.
YAFIT-668 закрыт: PR1848–1851 в main c88f2c21;
[итоги и ограничения проверок](design/COACH_LIVE_FINISH_AND_ROLLOUT_20261028.md).
YAFIT-667 завершён: PR1847/main91ce5582, общие правила и архив сохранены.

## Android OTA — выпуск1.1.4

03.11: PR1944 изменил ABI; APK1.1.4/code9 разрешён после приёмки1954.
Подготовка; CI/подпись/публикация впереди, телефон не проверен.
[План, проверки и ограничения](design/ANDROID_OTA_RECOVERY_20261028.md).

## Действующие границы

- Frontend/API/PG/media — Cloud.ru, внешний вход — Yandex ID.
- Vercel — redirect, Supabase — ограниченный legacy, не второй backend.
- Runtime/decommission: [playbook](YANDEX_CUTOVER_PLAYBOOK.md).
- [Контракты](ACTIVE_CONTRACTS.md); [карточка CPA101–105](design/CLIENT_PROFILE_LIME_20261104.md).
- YAFIT-668 заменил прежний fixed2-запрет: явный coach pilot/all/off; Original54/Compact48 сохраняются. Текущую конфигурацию проверять отдельно.
- Локальные тесты не используют production-БД; полные макеты/пакет шрифтов не публикуются.

## Видеовстречи / YAFIT-669

[План](design/CHAT_VIDEO_MEETINGS_20261028.md): собственный UI, Jitsi как media.
Jitsi/TURN работают на существующей VM; public media rules применены.
PG17/RLS проверены в CI; WebKit UX — с SDK double. Реальные двусторонние
audio/video и forced TURN/TLS проверены в Chromium с синтетическими устройствами.
28.10 пользователь разрешил включение, перенеся физические телефоны на этап
после включения. API a612842a выпущен40699668008; runtime flag/config
подтверждены40699988438, public health/ready200. Проверка телефонов ожидается.

## Параллельная работа и остатки

YAFIT-659/PR1842 слит в main8f254a3b: поиск еды и единый импорт штрихкода.
[План и проверки](design/NUTRITION_COVERAGE_AND_SINGLE_IMPORT_20261027.md).
Сверять актуальные PR/head и новый CI; production/физическое сканирование
не подтверждены, пилот питания прежний.
Main включает клиентские PR1845/1846, их изменения сохраняются.
YAFIT-662/PR1844 слит; последующий UX-аудит выявил отдельные замечания.
Задача про правила их не исправляет: [реестр](REGRESSION_LESSONS.md).

## Не закрывать при уборке документации

- Supabase/rollback: [план](design/SUPABASE_DECOMMISSION_PLAN_20261023.md)
  и [P0-аудит](design/SUPABASE_P0_RESOURCE_AUDIT_20261024.md).
- Исторические media reconciliation, OAuth/device и background-проверки
  содержат ограничения; сверять их актуальность в соответствующей задаче.
- Старые записи сохранены, но не объявлены завершёнными. PR1745 уже merged20.10,
  хотя прежний snapshot называл его готовящимся.
- Физический телефон не считается проверенным по симулятору/WebKit.
- Branch rules требуют admin; зелёный CI обязателен по процессу независимо
  от фактических настроек GitHub.

## История

[Полный прежний snapshot](archive/workflow-20261027/docs/CURRENT_STATE.md)
сохранён побайтно. [Поисковый индекс](archive/workflow-20261027/INDEX.md)
содержит строки, тикеты и документы для восстановления контекста области.
Заменённые общие инструкции сохранены в [архиве28.10](archive/workflow-20261028/README.md).
Перед её изменением читать связанные решения и незакрытые ограничения.
Не добавлять журнал CI сюда: доказательства — в задаче/PR.
