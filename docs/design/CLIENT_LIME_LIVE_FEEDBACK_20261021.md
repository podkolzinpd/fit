# PR7 — сообщения фаз, сохранение и повтор Live, 21.10.2026

## Preflight и границы

База28ecbeee после PR6; локальный clientReference gate. Новый baseline4/4
повторно подтвердил R11/r14 и пересечение SaveStatus с галочкой. Существующий
SaveStatus, live-phase-notice, live-sync-state и обработчики используются дальше.
Точного SVG phase notice/TimeWheel нет: геометрия адаптирует уже принятые
действия/r20 и поля/r16, палитра/шрифты из действующей клиентской системы.

## R11/R12 — исправление представления

- SaveStatus занимает статическую строку под полями, не рисуется поверх
  значения/галочки. Для idle/saving/saved постоянно отведено16px подписи:
  высота формы не меняется при обычном autosave. Подробная ошибка при
  необходимости переносится и расширяет строку, а не перекрывает контролы.
- Сохранены saving/saved/error/role, семантические цвета и подтверждение.
  Общий SaveStatus и его потребители Nutrition/Feedback/тренер не меняются.
- live-phase-notice получает clientReference grid/text/action, r20, secondary
  r16/44 и действующие поверхности. Исправить/Вернуть вызывают прежний undo;
  исправление подтверждённого не отменяет серверное подтверждение.
- В реально открытом error state обнаружена и нижняя live-sync-state:
  старая r14/кнопкаr10/600насыщенность. Клиентский вариант r20/r16/YS Geo500
  сохраняет danger/warning surfaces и существующий retry.

## R12.1 — подтверждённая гонка повторного подтверждения

Новый тест нижнего «Повторить» воспроизвёл WebKit-сбой: после503confirm
последующий blur-autosave мог удалить pending draft, хотя подтверждение ещё
ожидалось. Нижний retry не завершал команду; ряд оставался неподтверждённым.
На родительской сборке6355 без PR7 WebKit воспроизвёл сбой; Chromium в этом
повторе его НЕ воспроизвёл. Не утверждаем постоянный сбой всех движков.

Источник acknowledgeLiveDraft в WorkoutsPages.tsx: guard
`coachReference && !confirmationComplete && pendingSetConfirmations.has(setId)`
защищал только тренера. Переиспользован тот же guard для visualReference
(coachReference || clientReference), без новой очереди/команд/серверного
контракта. Blur не признаёт запрос подтверждения завершённым; настоящий ack
и удаление упражнения сохраняют прежнюю очистку. Вне пилота поведение прежнее.

## Проверки

- Исходные24новых browser cases:8saving/saved/stable geometry,8error+rowretry,
  8phase correction/restundo, обе темы/плотности/движка;390/430 в geometry.
  Все прошли до добавления проверки нижнего retry.
- Расширенный error retry дал2WebKitfail/6pass; после guard и добавления
  явного blur перед нижним retry8/8pass. Проверены оба пути повторной отправки,
  27.5кг и сохранение команды подтверждения.
- Связанные38cases keyboard/swipe/fold/hold/time passed.
- Визуально просмотрены сохранение, ошибка и notice в окончательной композиции.
- Первоначальный полный check прошёл до последней защиты retry; окончательный
  pr7-stable-check и полный260client acceptance проверяются отдельно.
- Локальные квитанции outputs/client-workout-reference-audit-20261021:
  pr7-preflight,pr7-feedback,pr7-mechanics,pr7-sync-error,
  pr7-retry-baseline-final,pr7-sync-retry-fixed,pr7-stable-check,pr7-all-client.
  Отрицательный baseline Chromium не является неуспехом готовой функции:
  это намеренная проверка воспроизводимости старого дефекта.

Права/данные/API/расчёты/LLM/SpeechKit/allowlist не меняются. R02/REM/плотности/
анимации/ввод чисел/перенос карточек сохранены. Свежий main/CI/официальная
публикация и проверка её JS/CSS обязательны до закрытия задачи. Физический
iPhone и отдельные ограниченные Assistant-потребители НЕ ПРОВЕРЕНЫ.

## Окончательная локальная приёмка

Полный клиентский набор260/260WebKit+Chromium прошёл после последней защиты retry. Lint/types прошли; два посторонних сбоя ExercisePicker timeout/асинхронного ProgressPages-теста в первом полном запуске перепроверены полным frontend-набором с2workers:2801passed. Все оставшиеся стадии check/API1434+186standardDBskip/политики/build завершились exit0 (pr7-check-recovery.log). Лимиты и CI не менялись. Публикация/приёмка физического iPhone этим не подтверждаются.
