# YAFIT-626 — исполнение утверждённого плана

Неизменяемый план: [COACH_FOLLOWUP_FIXED2_20261018.md](COACH_FOLLOWUP_FIXED2_20261018.md).
После его фиксации владелец разрешил реализацию всех шести PR, штатное слияние
после зелёного CI и полный production-выпуск. Ограничение прежнего fixed2 сохраняется.

## PR 1 — Планирование

База: main26f59eef, затем интегрирован mainе2d931d4/PR1697. Проверяемая сборка: локальный Vite на этой базе,
синтетический trainer/server Lime, независимые WORKOUT_REDESIGN/PLAN_INPUT/PLAN_LAYOUT fixed2.
До кода открыты реальные маршруты редактора плана, Live, недели и Day; WebKit2/2.
SVG и source crop сохранены в приватной диагностике coach-readonly-audit-20261018.
Физический iPhone не проверен и не выдан за пройденный гейт. Figma MCP не дал
доступ; по прямому требованию владельца источник — его сохранённые исходные SVG.

| Проверка существующего | Решение и доказательство |
| --- | --- |
| Уже работает | План48, заметки, ввод, объединение со следующим, подтверждение изменения кругов; редактор/групповой маршрут WebKit |
| Переиспользуем | WorkoutExerciseEditor, WorkoutSwipe, resizeDraftBlockRounds/changeRoundCount/useConfirm, PLAN_LAYOUT, Lime tokens |
| Действительно меняем | Лишние18px перед строкой, select22px, исходное многоточие19×4 вместо уменьшенного generic, вход удаления последнего круга |
| Не проверено | Физический iPhone/реальные пользовательские сессии; новый server/API/SQL не требуется |

Primary: прежняя верхняя галочка «Сохранить план». Состояния: обычные/групповые
упражнения, заполненные/пустые/выполненные строки, отмена подтверждения,
последний круг, pending/disabled, RPE/время/дистанция, error/retry и клавиатура.

| Пункт плана | Видимый результат | Проверка | Статус |
| --- | --- | --- | --- |
| PR1 отступы | Первая строка149px от карточки вместо167px; карточка растёт по содержимому | SVG crop + browser measurements | Локально пройден |
| PR1 контролы48 | Тип блока/круги одной высоты с полями; disabled по прежнему состоянию | Existing refined-plan browser assertions | Локально пройден |
| PR1 многоточие | Исходный контур element2214, viewport24; path сохранён без изменения | Existing full-editor assertion + screenshot | Локально пройден |
| PR1 группы | Удаляется последний круг целиком; подтверждение/отмена/last/source guards прежние | Existing reference-plan component and browser cases extended | Локально пройден |
| PR1 сохранённая механика | План48, RPE, split, ввод/черновик/заметки/первый тап | Existing plan-input/full-editor matrix | На обновлённой базе WebKit11/11 + Chromium11/11 пройдены |

Существующие тесты расширены без новых параметрических осей и без изменения
числа acceptance cases. Защищённый digest не переписывается; сокращение CI
остаётся fail-closed. На исходной базе полный check exit0: frontend2740,
API1426+160штатныхDBskip, policy/build/startup passed. После rebase lint/typecheck
прошли; полный frontend упёрся в прежний ExercisePicker timeout5s, точный повтор
прошёл637ms без изменения продукта/теста/таймаута. Полный coverage с maxWorkers2
и все оставшиеся стадии check повторяются. Первый добавленный unit assertion
ожидал результат async-confirm слишком рано; добавлен waitFor, продукт не менялся
ради этого сбоя. CI/merge/deploy ещё не выполнены.

## PR 2 — Live-композиция и анимация

База b521f9c5/PR1700, включающий mainе2d931d4. В отдельной worktree воспроизведён
исходный Live390 в original/compact с исходными YS Geo2/2 и синтетическими данными.
Первый запуск без локально подготовленных шрифтов не принят за визуальную приёмку;
шрифты подготовлены из уже предоставленных файлов, правильный baseline повторён.
Figma недоступна; контуры сверены с сохранёнными исходными SVG. Два новых cropped
assets сохраняют исходный path byte-for-byte; полные доски не публикуются.

| Проверка существующего | Решение |
| --- | --- |
| Уже работает | Density setting, original54/compact48, единый Live/timer/drafts/notes |
| Переиспользуем | LiveSetInput/Fields, WorkoutSetRow, CheckSmallIcon, useLiveExerciseAnimation, Switch, четыре независимых fixed2 guards |
| Меняем | Баланс пустого хвоста, исходные верхняя галочка/многоточие/отдых, scoped default анимации off |
| Не проверено | Физический iPhone, реальная пользовательская сессия; Doto остаётся известным приближением |

Primary — прежнее подтверждение подхода. В оригинале54px/compact48px;
на375px ширина силового поля84,5px сохранена, бывший tail56 стал inset28+28.
Единицы оригинала вторичны9px; editable digits16px и touch targets не уменьшены.
Верхний видимый круг40 внутри target44, исходный check-small2,5px. Сохранённые
true/false настройки анимации имеют приоритет, default-off передаётся только
закрытым trainer density guard; shared default остальных потребителей прежний.

| Пункт | Проверка | Статус |
| --- | --- | --- |
| PR2 строка54/48 и баланс | Existing density composition375/390/430/1440, обе стороны inset, ширина84,5 на375 | Локально пройден |
| PR2 поля разных метрик/состояний | Existing metric completion: сила/планка/бег/гребля/проходка/лестница, quiet fields retry | Локально пройден |
| PR2 оригинальные значки | Exact path comparison2/2; browser check-small/visible circle40/target44, rest16 decoded | Локально пройден |
| PR2 настройка анимации | Existing second-pilot settings persistence, composition default-off, outside trainer/client guards; explicit-on in existing animation cases | Локально пройден |
| PR2 сохранённая механика | Existing card/top completion и focus/density flow | Локально пройден |

Targeted unit23/23 и typecheck/lint passed; browser92/92 WebKit+Chromium passed.
Новых browser cases/осей нет; существующие анимационные случаи явно включают
настройку вместо прежнего неявного default. Полный check exit0: frontend2743,
API1426+160штатныхDBskip, policy/hosting/calendar/build/startup passed. Финальный
диагностический WebKit390 и просмотр source/after подтвердили композицию и assets.
CI/merge/deploy/native остаются обязательными; PR1 пока не объявлен выпущенным.

## PR 3 — Рабочий свайп без конфликтов

База7e56b8b8/PR1701 после переноса code-only9234d0ba; runtime tree не менялся
при переносе документации. На исходном Live390 Chromium CDP воспроизведено:
свайп с поля оставлял actionCount0/inputFocusedtrue. После изменения тем же
жестом actionCount1/inputFocusedfalse. Артефакты приватные pr3-before/pr3-after.

| Проверка существующего | Решение |
| --- | --- |
| Уже работает | Свайп номера, перенос/автоскролл, подтверждение/отмена, coordinator, last/confirmed guards |
| Переиспользуем | WorkoutSwipe opt-in, LiveSetInput, Live form change detection, changeRoundCount и removeLastLiveRound |
| Меняем | Различение tap/pan/swipe на неактивном поле, WebKit compatibility mousedown, utility focus/blur без ложного fact |
| Не меняем | Активное редактирование/выделение, checkbox/select, клиентские жесты, серверные команды/права/лимиты |

Primary — прежняя галочка подхода, удаление остаётся вторичным явным действием.
Фокус отложен до trusted pointer-up только у opted-in неактивного поля;
горизонтальный жест не открывает клавиатуру, вертикальный не блокирует прокрутку.
Кнопка времени получает ровно прежнее действие. Client/default потребители
WorkoutSwipe opt-in не получают. Вложенная строка не запускает удаление упражнения.

| Пункт | Проверка | Статус |
| --- | --- | --- |
| PR3 начало с поля | Before/after CDP + existing set-touch обе identities; gutter сценарий сохранён | Локально пройден |
| PR3 tap/pan/cancel/edit | Два целевых unit; existing trusted touch field pan, tap/select/Next и native duration dialog | Локально пройден |
| PR3 вложенность/защита | Existing field completion/remote-confirm conflict/retry/last guards | Локально пройден |
| PR3 суперсет | Merge/append/cancel/delete whole last empty round/split; после cancel facts остаются{} | Локально пройден |
| PR3 перенос/стабильность | Existing touch drag и plan-input/confirmed edit сценарии | Локально пройден |

Обнаруженный в WebKit соседний источник ложного fact подтверждён browser assertion:
выход из нетронутой формы мог записывать отображённый план. Scoped guard использует
уже существующий liveFormChanged/local drafts; utility focus/blur исключён из ввода.
Настоящий ввод, autosave, validation и coordinator не заменены.

Targeted unit62/62; итоговый fullcheck exit0 frontend2745/API1426+160штатныхDBskip,
policy/build/startup passed. Browser41passed/3 штатных CDP-only skip; эти3 не
засчитаны как passed. CDP field pan и swipe реально прошли в Chromium, WebKit
проверен отдельно mouse/native focus и формами. Физический iPhone не проверен.
Первый клиентский browser отказ был fixture-флагом CLIENT_LIME в новой worktree,
не продуктом: исправлен только приватный harness. Контракт server round API
прежний: произвольные круги и факты не разрешаются. Новых browser cases/осей нет,
добавлены два unit на отличающиеся риски. CI/merge/release/native впереди.

## PR 4 — Непрерывная шапка

Интеграция19.10: собственные изменения PR4 перенесены на фактический main
d236e4ab после штатного merge PR1702. Исправление native-touch/capture PR3
сохранено; новый source tree заморожен для повторных проверок. Выпуск PR2
подтверждён public207/207, health, compiled4closed2/originalpair и native207/207;
PR3 проходит mainCI/автовыпуск. Слияние PR4 — только после production readback PR3
и собственного свежего exact-head CI. Исторические результаты ниже не заменяют
этих интеграционных гейтов.

База PR1702/2cc1252c. В WebKit390 воспроизведены четыре сочетания
original/compact × Live/rest на промежуточных позициях0/40/100/194 и0/20/50/84.
Причина полосы: фон pinned оставался на -44px даже при изменении его viewport top,
а фон header оставался на0. Source SVG задаёт исходную композицию, но не движение.

Уже работает: sticky rest, общий таймер/отрицательный отдых, плотности54/48,
навигация и единый DOM. Переиспользуем их и прежний radial-gradient; новый узкий
hook только синхронизирует paint-origin и долю видимости. Меняем: scroll/resize
сдвигает локальный фон к тому же viewport-origin и непрерывно гасит оба фона с
цифрами. Никакого fixed-background, React-scroll-state, forced scroll, remount или
новой фазы/кнопки. Reduced motion не запускает перемещений/таймлайнов.
Primary прежний — подтверждение подхода. Client/outside-cohort не затронуты.
Физический iPhone и реальный аккаунт не проверены. Публичный выпуск впереди.
Проверка:2/2 новых unit;30/30 существующих browser WebKit/Chromium375/390/430/1440,
включая промежуточный origin/fade/DOM identity и отдых через ноль. Все ступени
check пройдены: coverage2747, API1426+160standardDBskip, policy/calendar/hosting,
build/startup. Первый performance поиск1638ms при лимите1500 повторён с2workers
без изменения порога; sandbox EPERM bind relay снят повтором оставшихся ступеней
с разрешённым тестовым портом. После обновления parent от mainb38b76e1 обязательны
exact-head CI и production readback; старые результаты не выданы за их прохождение.

## PR 5 — Недельная панель

Предпубликационная база — actual main93f449c6 после выпуска PR1–4 и merge
более раннего docs-only1704. Обновлённые AGENTS/UI-контракты и полный Lime
дизайн-код перечитаны; источник недели тот же week-schedule/sha9ff64f0a,
новой палитры/иконок/компонентов нет. После фильтрового исправления полный
локальный check прошёл: frontend2752/API1441+161штатныхDBskip/build/startup;
обычный boundary-регресс8/8, контролируемый batch2/2, week/browser28/geometry3.
Общий код будущего PR6 поверх этого исправления также прошёл fullcheck2756,
API1441/build и browser20/20. На новой документационной базе повторяются
интеграционные проверки и свежий CI. До merge5 обязательны publication/readback
предыдущего93f и собственный зелёный exact-head CI. Физический iPhone не проверен.

Интеграция19.10: поверх PR4/headfd54482c первоначальная полная цепочка прошла
frontend2752/API1441+161standardDBskip/build; browser28/28 и geometry3/3.
Отдельно разобран retry CI4: после быстрой смены фильтров счётчик становился2
вместо3. Контролируемая пара change в одном browser task воспроизвела потерю
первого URL-параметра в обоих движках (2/2 before fail). Это дополнительный
регрессионный сценарий, не имитация пройденного физического touch-теста.
Причина — следующий обработчик читает ещё не обновлённый router location.
Существующая навигация фиксируется синхронно только у прежнего fixed2;
не добавлены очередь, новое состояние, настройки или действие. Тот же before
после исправления проходит2/2. Существующий boundary-case дополнен проверкой
двух изменений подряд; обычные native select/check, retry, Back и persist
проверки сохранены. Новых browser cases/осей, sleeps/таймаутов нет.
После этого изменения полный check и браузерные проверки повторяются.

Первичная проверка18.10 (историческая база и результаты):

База PR4/b7ed4535. Before WebKit375/390/430 воспроизводит перенос summary
влево при открытии. Открыты реальные календарь/фильтры, сверены с week-schedule.svg.
Уже работают calendar/list/range/client/status/independent/openDay; переиспользуем
все обработчики, детали/summary, Coachmark и source-токены. Меняем только сетку
панели: summary остаётся во второй колонке, содержимое раскрывается под обеими;
период44px, пустой день без повторной видимой подписи, но с sr-only описанием.
Primary прежний — «Новая тренировка», не добавлено ни одного нового действия.
Фильтр Day из1697 не возвращается. Outside-fixed2 остаётся прежний вид.
After375/390/430: summary x/y/width неизменны, скриншоты открыты и проверены.
Первый вариант grid на details дал наложение native details-content: обнаружен
визуально и заменён обычным потоком; не принят как готовый по одним координатам.
Физический телефон/пользовательский вход не проверены. Локально28/28 существующих
browser WebKit/Chromium: four-width fixed2 editor/guide/filter geometry,
calendar/list/fortnight/selected date, history status/untimed и text/voice/manual
return-to-filtered-calendar;320px outside-cohort сохранён. Private geometry3/3.
Все ступени check: coverage2747/API1426+160standardDBskip/policies/build/startup
passed; sandbox port EPERM повторён с разрешённым тестовым портом. Широкий
диагностический запуск не принят как green: обнаружил старые unit10px и no-input
blur assumptions; они исправлены в родительских PR1701/1702, их отдельные проверки
8/8 и4/4 passed. После обновления parent от mainb38b76e1 нужен exact-head CI.
Merge/Cloud.ru/readback/native впереди; новых browser cases/осей нет.

## PR 6 — День/направленный переход

Финальная интеграционная база — actual mainb5d54357 после штатного merge PR1705
на head5f7587ef/freshCI39172282277; более ранний docs-only1704 опубликован93f,
public207/health/compiled4closed2/frozen original pair passed. PR1–4 полностью
выпущены и отмечены в YAFIT-626. PR5 проходит mainCI39199666522 и автовыпуск;
его publication readback обязателен до merge6. При переносе сохранены оба
дополнения Wiki: быстрые фильтры PR5 и свайп Day, все соседние CURRENT_STATE notes.

Общий runtime всех шести этапов перед этим переносом проверен полностью:
frontend2756/API1441+161штатныхDBskip/policy/build/startup и browser20/20,
включая филтровый регресс; trusted touch2/2 проверен отдельно. Новый source tree
повторно заморожен для current-main check/browser и exact-head CI. Оригинальная
геометрия54/48/48 и удаление Day-фильтра1697 сохранены, клиентские сценарии не
мигрируют. После6 обязательны public/compiled/frozen readback и свежая нативная
сборка merged current main. Физический iPhone/OAuth не проверены.

База before0886b149. Before WebKit/Chromium390: реальный Day и горизонтальный
жест по дате не меняли URL. Day-filter1697 уже отсутствует; он не восстанавливается.
Source day-schedule.svg сохраняет статическую композицию/шрифт/контролы, движения
в SVG нет. Переиспользуем Page, выбранную LocalDate и openDay без нового календаря.
Primary прежний — «Новая тренировка». Нового действия/фазы тренировки нет.

Новый узкий hook распознаёт завершённый горизонтальный жест на свободной
поверхности, один gesture — один addDays/openDay. Vertical/cancel/short/edge28,
buttons/links/inputs/dialogs остаются прежними. Два реальных слоя date+weekday
движутся противоположно и crossfade220ms; направление соответствует жесту.
Предыдущий слой aria-hidden; reduced motion без перемещения. Список привязан к
той же дате, смена недели использует существующий loading/query, не старые строки.

Найдено и исправлено на реальных движках: WebKit Back восстанавливает range в
non-editable дате, что блокировало следующий свайп; обычное выделение текста вне
даты остаётся нативным. Trusted Chromium touch обнаружил bubbling child capture
loss при передаче implicit capture корню: это больше не считается отменой. Root
loss/cancel проверяются по pointerId, чужой старый pointer не отменяет новый жест.
Приватные pointer JSON сохраняют воспроизведение; fake mouse не выдан за touch.
Физический iPhone и OAuth не проверены. Frozen3c39f2ef:4/4 unit,18/18 existing
browser WebKit/Chromium375/390/430/1440 (включая third refusal и history/Day filters),
private2/2 с настоящим Chromium CDP touch: оба направления, cancel, native vertical
pan. Все ступени check на обновлённой базе passed: frontend2752/API1441+161skip,
policy/calendar/hosting/build/startup. Отдельных browser cases/осей не добавлено.
Первый real partitions отказ был гонкой самой диагностики: e2e-файл менялся между
последовательными list-командами. Финальный source заморожен до запуска, union и
protected digest/gates прошли без изменений. Полные logs/контуры/шрифты остаются
приватными. Exact-head CI/merge/Cloud.ru/public readback/native — следующие гейты.

## Интеграционный журнал и предпубликационный статус

### Интеграционная перепроверка PR3 — 19.10

После штатного выпуска PR1/#1700 и слияния PR2/#1701 ветка PR3 перенесена
на фактический main c8e72357. Linux Chromium воспроизвёл настоящий дефект,
которого не показал macOS: после горизонтального жеста браузер мог проглотить
первый native tap по «Удалить». Локальный non-passive touchmove предотвращает
только уже определённое горизонтальное движение; вертикаль, multitouch и
активные поля остаются браузеру. Включение — только прежний reference fixed2.

Отдельная проверка заголовка упражнения обнаружила потерю implicit pointer
capture при передаче дочерний заголовок → swipe surface. Игнорируется только
всплывшая потеря дочернего capture, настоящая отмена поверхности сохраняется.
Публичные source-тесты расширены внутри прежних двух случаев без новых осей,
таймаутов, sleeps, JS-forced clicks или ослабления проверок. На реальном native
touch Chromium Linux оба случая (включая Delete/Cancel, поля, tap/fill,
вертикальный pan и swipe упражнения) прошли 2/2; компонентные тесты 30/30.
Финальный полный check и двухбраузерная проверка запускаются на замороженном
source tree. Это локальное подтверждение, не заявление о выпуске PR3.

1. Планирование, PR1700 — production и native readback пройдены.
2. Live-композиция/анимация, PR1701 — production и native readback пройдены.
3. Свайп/перетягивание, PR1702 — production и native readback пройдены.
4. Непрерывная шапка, PR1703 — production и native readback пройдены.
5. Недельное расписание, PR1705 — merged mainb5d54357, выпуск проверяется.
6. День/направленный переход, PR1706 — реализован на main5, fresh CI и выпуск впереди;
   удаление фильтра Day из1697 сохранено.

Это snapshot до публикации последнего PR, не заявление о шести готовых выкатках.
Проверенные факты завершения каждого выпуска, checklist и итоговый статус —
[YAFIT-626](https://tracker.yandex.ru/YAFIT-626).
