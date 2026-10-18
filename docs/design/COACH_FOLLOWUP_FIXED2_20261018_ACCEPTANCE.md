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
настройку вместо прежнего неявного default. Полный check выполняется.
CI/merge/deploy/native остаются обязательными; PR1 пока не объявлен выпущенным.

## Следующие PR

2. Live-композиция и существующая настройка анимации — локально реализован, выпуск впереди.
3. Свайп/перетягивание — не реализован, PR1 использует прежний обработчик.
4. Непрерывная шапка Live/отдыха — не реализован.
5. Недельное расписание — не реализован.
6. День/направленный переход — не реализован; соседний PR1697 убирает фильтр.
