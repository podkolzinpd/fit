# PR6 — вложенные окна времени Lime, 21.10.2026

## Проверка существующего

База10b08fb5, локальный фактический клиентский gate. Перед кодом повторно
открыты отдых/фактическое время в обоих движках4/4: generic picker-header и
старые r28 остались. Точные SVG этих двух окон отсутствуют; это явная
адаптация действующего клиентского окна даты, не заявление о копии макета.

## Переиспользовано и изменено

- FitLimeSheetHeader вместо локального picker-header. Единственное primary
  применение остаётся снизу, второе применение не добавляется.
- Оболочка существующего client-lime-date-sheet: lime-radius-sheet40,
  lime-surface/text, ширина440max, доступная высота, отступы20 и safe-area.
  Secondary48/r16 и primary60/r20 используют существующие роли и токены.
- LiveRestTimer выбирает оболочку только через уже переданный
  referenceActions=clientReference.
- WorkoutDurationField наследует ClientWorkoutReferenceContext из клиентской
  ветки AppLayout. Значение вычислено тем же реальным gate, что класс оболочки;
  defaultfalse и отсутствие provider у тренера сохраняют их оформление.
  Это только контекст представления для общих контролов/portals, не новый
  feature-flag/авторизация и не вывод cohort из localStorage.
- TimeWheel, секундное хранение, hidden input/FormData/input event,
  keyboard-vs-wheel preference, draftRef, apply/remove/cancel, пресеты,
  callbacks/expiry/gong/phase/owner остаются прежними.

## Проверки

12новых browser cases прошли:2темы×390/430×2движка проверяют оба окна,
точные10секунд, отмену черновика, повторное открытие, remove, нулевой disabled
отдых, пресет/старт/остановку; ещё4cases изолируют тренера и клиента вне пилота.
31unit duration/rest passed, включая наследование через portal/отмену/105секунд.
Первый browser assert предполагал aria-activedescendant, которого у TimeWheel
нет; исправлен тест на существующий option aria-selected, UI не менялся.

Дополнительная приёмка editor keyboard/wheel, manualwork/pause/Live keyboard
и полный check выполняются перед публикацией. Контекст автоматически достигает
Today/WorkoutExerciseEditor/RunMetricsFields/AssistantHistory/AssistantProgramPilotCard.
Первые три покрываются клиентскими сценариями и общими unit; отдельный
визуальный вход в оба ограниченных Assistant-потребителя этим проходом
НЕ ПРОВЕРЕН. Их кодовая достижимость не выдаётся за просмотр UI.

Тренерский CoachPlanTimeField не меняется. Открытие окон вне пилота подтверждено
с прежней оболочкой. Физический iPhone НЕ ПРОВЕРЕН. CI/точный main/публикация
ещё обязательны. Локальные квитанции outputs/client-workout-reference-audit-20261021:
pr6-preflight,pr6-sheets-final,pr6-unit,pr6-mechanics,pr6-check.
