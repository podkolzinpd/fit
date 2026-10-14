# Оплаты и шаблоны: устранение повторных цепочек — 15.10.2026

## Подтверждённая задача

> Начать с оплат и шаблонов.
> Сейчас они дают 32 и 18 длинных проходов соответственно. Это самые очевидные
> кандидаты: можно устранить повтор действий, сохранив уникальные проверки.

Владелец подтвердил: «давай теперь вот это».

## Неизменяемая приёмка

1. Сохранить контракт оплат: создание с начальной оплатой/датой, полная сумма,
   частичная оплата, редактирование, подтверждение удаления/отмена, доплата,
   request IDs, список оплат и reload. Проверить Mono и Lime в обоих движках.
2. Сохранить контракт шаблонов: медленный health preflight, pending/disabled,
   отсутствие преждевременного POST, потерянный ответ после записи, безопасная
   диагностика, сохранённый черновик после reload, одинаковая команда retry,
   одна запись и очистка черновика. Проверить Mono и Lime в обоих движках.
3. Сохранить исходные темы, размеры, layout/overflow assertions и снимки
   состояний. Реальные ввод, focus/клавиатура/сохранение оплаты и копирование
   диагностики остаются в матрицах: они зависят от геометрии и hit targets.
4. Сопоставить каждую прежнюю assertion с новым поведением или визуальной
   проверкой; остальные тесты, runtime, API, БД, таймауты и retries не менять.
5. Замерить исходные/новые целевые тесты в одинаковом локальном окружении;
   проверить полную приёмку, lint/typecheck и npm run check. Не выдавать сумму
   длительностей отдельных случаев за время ожидания CI.
6. Проверить union/disjoint CI-частей, critical/feature tags и новый inventory.
   Изменённый spec выключает временный scoped CI до явного аудита. Digest не
   обновляется автоматически; окно/allowlist/required gates не расширяются.

## Scope

Только два registration blocks и их изолированные page-scoped fixtures.
UI/продуктовые данные/сервер/миграции/deploy/native не меняются.
Другие повторы не устраняются в этой задаче.

## Матрица старых проверок → новое покрытие

| Прежняя проверка | Новое покрытие |
| --- | --- |
| Оплаты: начальная сумма/дата, requestId, «Вся сумма» | `Finance payment lifecycle behavior`, `mockFinancePaymentLifecycle`; ввод/«Вся сумма» также в visual |
| Оплаты: частичная оплата, изменение5000→3000, остатки15000/17000 | behavior через реальные UI-действия и page-scoped HTTP mocks |
| Оплаты: подтверждение суммы/даты, отмена без удаления, удаление | behavior; тот же ledger, assertions и порядок действий |
| Оплаты: доплата, статус/нулевой долг,2 разных receipt IDs | behavior; visual готовит окончательное состояние через `seedPaidFinanceFixture` |
| Оплаты:2 строки, таб оплат,30000 после reload | behavior и visual; totals/list проверяются на реальном маршруте |
| Оплаты: поля рядом,44px CTA,save/cancel рядом,клавиатура400px,scroll/overflow | прежние16 visual-конфигураций/engine, реальное сохранение формы после focus |
| Оплаты: снимки new-service/service-paid-due/payments-expanded | прежние3 снимка в каждой visual-конфигурации; только полный paid state теперь fixture |
| Шаблоны: preflight46s age,2192ms delay,1 health,pending disabled,POST0→1 | `Template slow connection and diagnostic retry behavior`, Mono/Lime в обоих движках |
| Шаблоны: ошибка/код поддержки,копирование/«Скопировано» | behavior и прежние9 visual-конфигураций/engine, реальные save/copy действия |
| Шаблоны:диагностика POST/network без secret/title/preflight-ошибки | behavior и `copyTemplateDiagnostic`; прежние safety assertions |
| Шаблоны:черновик/reload/retry,commands2 и exact equality,rows1,cleanup | behavior и `mockTemplateUncertainSave`; первая запись действительно предшествует потере ответа |
| Шаблоны:copy CTA44px,scroll/overflow,снимок ошибки | прежние9 visual-конфигураций/engine |

Структурная AST-сверка от22e08f4e:51 assertion sites /45 уникальных выражений
найдены в новых целевых callbacks/helpers без ослабления matcher. Остальные
233 callback bodies и все исходные fixture declarations не изменились.
Вместо50 полных проходов на два движка:8 полных +50 более коротких UI-проверок.
На исходной22e08f4e inventory620/engine =98 behavior +522 visual. После rebase
на mainb35ce27f сохранены4 новых client empty-entry cases изPR1631: текущий
inventory624/engine =98 behavior +526 visual. Union/disjoint проверяется
в реальном Playwright collection. Critical+finance94/engine.

Оси сохранены осознанно: Mono/Lime — разные поверхности формы; theme — прежние
настройки appTheme и граница наследования; width — реальный focus/keyboard,
hit target и overflow. Lime trainer остаётся dark при обеих appTheme-настройках;
название light здесь описывает входную настройку, не новый Lime light-дизайн.

Постоянная policy-проверка запрещает возвращать edit/delete/payment цепочку
в finance visual и clock/preflight/reload/replay в template visual. Она также
проверяет точные25 конфигураций и4 отдельных behavior cases в обоих engines.
Digest исходного аудита22e08f4e: `76115526a150739cd087a0b7371de7d36d85736babbf94d56fb2800018c44ef2`.
Повторный явный аудит mainb35ce27f: все45 assertions,234 остальных callbacks
(включая добавленный upstream) и старые fixtures сохранены. Новый digest:
`4c66c8e2a32cb675d6489c9c80806ba2c5bbdf6da3b8e944db1a9d9ad7cdc021`.
Новые incoming cases не получают новых tags, как вPR1631: затрагиваемые ими
ClientPortal/shared UI/CSS пути требуют full по существующему fail-closed
allowlist. Окно/allowlist/бюджеты/гейты не расширяются и не ослабляются.

## Проверки и тайминги

Исходный main:22e08f4e. Локально те же Playwright1.61.1, fonts SHA2562/2,
workers2, retries0, isolated mocked API и dedicated port5248. Замеры до/после
выполнялись последовательно, не против production/Supabase.

| Движок | До:25 cases | После:29 cases | Сумма attempt durations до→после |
| --- | --- | --- | --- |
| Chromium |36,205s|29,299s (−19%)|62,680s→52,857s|
| WebKit |55,355s|32,922s (−41%)|102,503s→62,042s|

Все58 новых целевых случаев прошли, retries0. Это один локальный сравнительный
замер, не гарантированное ускорение CI и не сокращение всего Lime на41%.
Первый smoke4/4; e2e typecheck/lint passed после удаления перемещённого unused
import. Policy21/21: real partitions,25 configurations, guards,expiry/digest.
Просмотрены WebKit390: новая форма/полностью оплаченная услуга/ошибка шаблона;
320/430/1440 и остальные темы входят в автоматическую целевую матрицу.
Полный `npm run check` прошёл: frontend2668/2668, API1387 passed +156 штатных
локальных DB-skips, media2/infra276/calendar12/hosting158, lint/typecheck/build.
Отдельный e2e tsc/lint и финальная policy21/21 прошли. DB/schema/runtime не
меняются; local:verify и реальные облачные запросы не выполнялись.
Первый полный локальный прогон запущен параллельно в одной worktree на
разных портах: Chromium617 passed/3 failed, WebKit615 passed/3 прежних CDP-only
skips/2 failed. Все5 failures — startup/navigation: приложение осталось на
«Открываем Fit…»/loading либо показало ошибку запуска, не ошибку финансового
контракта. Два finance visual упали на ожидании «Новая»/page.reload, остальные
три — неизменённые due-date/empty-template/calendar cases. Длительность
некоторых timeout attempts92–96s при стандартном30s лимите. Общий Vite-cache
двух серверов — гипотеза причины, не доказанный root cause.

После остановки обоих серверов ровно эти случаи повторены последовательно
с workers1 и repeat-each3: Chromium9/9, WebKit6/6, retries0, без изменения
assertions/timeout/кода. Первый полный прогон не назван зелёным; отчёты
сохранены. Изолированный полный PR CI остаётся обязательным гейтом.

После rebase mainb35ce27f: policy21/21 (624/engine и incoming guard), повторная
AST-сверка45 assertions/234 неизменённых callbacks/все старые fixtures passed.
Целевые новые +4 incoming cases проверены последовательно по engines:
Chromium33/33(32,6s), WebKit33/33(34,1s), retries0. Эти новые времена не
сравниваются с исходными25 cases: сюда добавлены4 upstream cases и full-env.
Свежий полный npm run check на этой базе прошёл exit0: frontend2668/API1387
+156 штатныхlocalDBskip/media2/infra276/calendar12/hosting158/build.
Изначальный check не повторялся вслепую: второй нужен только после merge1631.
PR CI — следующий обязательный гейт.

Перед первым CI main продвинулся07680d79 черезPR1636 (нейтральные helper imports).
Наши protected specs/fixtures не изменились послеb35, digest4c66c8e2 прежний;
conflict затронул только snapshot. Запись задачи перенесена к прежней записи
Fit Lime, весь новый main snapshot сохранён. Финальный check на076 exit0:
frontend2670/API1387+156 стандартныхlocalDBskip/media2/infra276/calendar12/
hosting158/lint/typecheck/build. Specs/guards не менялись относительно
проверенного b35, полный CI всё ещё обязателен.
