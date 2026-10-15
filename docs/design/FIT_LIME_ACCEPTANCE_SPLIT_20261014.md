# Разделение Fit Lime acceptance — 14.10.2026

Прямое решение владельца: разделить поведенческую и визуальную приёмку.

## Acceptance

1. Поведение и визуальная матрица имеют явные, непересекающиеся наборы.
2. Сумма наборов сохраняет прежние 616 случаев в каждом browser engine;
   assertions, данные, retry/error/ownership и варианты ролей не удаляются.
3. Каждый набор проходит в Chromium и WebKit. Тяжёлая визуальная приёмка
   распределяется по независимым CI shards; стабильный required `e2e`
   требует успеха всех частей.
4. Отчёт сохраняет длительность каждого теста и показывает медленные случаи
   без payload, скриншотов, пользовательских данных и секретов.
5. Временный PR scope не расширяется: после изменения spec — full до отдельного
   аудита. Main/manual остаются полными; expiry не переносится. Повторный аудит
   должен учитывать оба spec и общую fixture, а не только старый файл.
6. Приложение, API, БД, production deployment и native bundle не меняются.

## Границы

Визуальная приёмка включает смешанные сценарии, в которых действия нужны для
проверки состояний UI. Наличие screenshot само по себе не доказывает, что
проверка исключительно визуальная. На первом этапе смешанные сценарии остаются
целиком; дедупликация их бизнес-действий требует отдельной матрицы доказательств.
Полный локальный прогон остаётся доступен одной командой.

## Проверки

Механический перенос от main `a0b35914`: 94 behavior + 522 visual/mixed = 616
случаев на engine. Ни один случай не удалён или не продублирован. AST-проверка:
235 callback bodies и все fixture declarations byte-identical; expanded
titles/tags совпадают с прежним inventory. SHA256 отсортированного массива
callback bodies: `58a9b41c3d77df960d2b5bcc728ec5bbd93438183bd2fdf26dfdf16eba5e09c0`.
Исходный spec: `d6309f4ececefce091893e2198389c491d6171da5bf06b09f4d79669179b3fc0`.
Это явный повторный аудит переноса, не автоматическое обновление SHA256.
Новый digest включает пути и bytes обоих spec и fixture; правка любого из трёх
файлов возвращает временный PR scope в full.

Full CI: два прежних engine × (behavior 1/1 + visual 1/4…4/4), два worker на job.
Scoped PR CI: behavior 1/1 + visual 1/1 на engine (4 jobs), чтобы не размножать
setup для уже маленького набора. Выбор matrix приходит из того же fail-closed
scope gate, без пользовательского bypass input.
`e2e` остаётся required и проверяет результат всей matrix; `continue-on-error`
нет, таймауты/retries не менялись. Цена ускорения — 10 runners вместо 2 и
дополнительная подготовка на каждом; суммарные runner-minutes могут вырасти.
Ускорение wall-clock будет измерено по фактическому CI, не обещано заранее.

Новый timing reporter экспортирует только case hash, basename/line/column,
project, duration, retry и status; не сохраняет titles, errors, stdout или
attachments. Отчёт и top-10 доступны даже на успешном CI, retention 7 дней.

Финальная локальная full acceptance (без retry): Chromium616/616, 8,8min;
WebKit613 passed/3 прежних CDP-only skips, 10,5min. Оба перенесённых набора
проверены полностью, не только CI-shards. Самый медленный Chromium case6,7s;
behavior даёт13% суммарных attempt durations, visual/mixed87%.
Локальные цифры нельзя сравнивать напрямую с Linux CI32min.

Policy57/57: full union/disjoint в обоих engine и scoped critical+finance
union92/engine; отдельно проверены45 старых scoped shards на непустоту.
Lint, E2E typecheck, JS syntax, YAML и diff-check passed. Полный `npm run check`
exit0: frontend2659, API1360 passed/142 штатных DB skips, infra268, hosting137,
build passed. DB/RLS отдельно не запускались: схема/runtime не менялись.
Exact-head CI ещё гейт; runtime/production/native изменений нет.

Первый exact-head CI `38600914500` на `2da03788` — success. Все10 частей
прошли: Chromium616 attempts/616 cases, retry0/skip0; WebKit616 attempts/
616 cases, retry0/3 прежних skips. Из10 timing artifacts восстановлен полный
union без дублей. Chromium span6min33s; WebKit span11min18s, включая поздний
старт двух shards из очереди. Самые длинные тестовые части5min41s и8min29s.
Предыдущий full CI `38461484831`: Lime jobs26min31s и34min35s соответственно.
Это замер CI до merge, не гарантия постоянного времени или runner cost.

Более ранний PR1623 слит; ветка обновлена от `3b910679`. Browser specs/fixtures
не изменились. Повторный полный check exit0: frontend2659/API1361,
148 локальных DB skips (142 actor + 6 upstream recovery), infra269/hosting137,
build passed. Recovery PostgreSQL tests выполняются в CI на отдельной базе,
добавленной upstream PR1623; локальная БД не сбрасывалась. Новый exact-head CI
обязателен после rebase; текущий head/результат merge — в PR1624.

Первоначальный локальный прогон остановлен после предупреждений Vite о font
allowlist для symlink dependencies. Зависимости затем скопированы внутри
worktree, browser fixtures проверены на отдельном локальном порту. Финальные
полные результаты выше относятся только к исправленному окружению.
