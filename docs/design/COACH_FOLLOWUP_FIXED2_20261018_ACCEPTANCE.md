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

## Следующие PR

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

2. Live-композиция и существующая настройка анимации — локально реализован, выпуск впереди.
3. Свайп/перетягивание — локально реализован и проверен, выпуск впереди.
4. Непрерывная шапка Live/отдыха — локально реализован, выпуск впереди.
5. Недельное расписание — не реализован.
6. День/направленный переход — не реализован; соседний PR1697 убирает фильтр.
