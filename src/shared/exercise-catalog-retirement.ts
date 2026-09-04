import type { ExerciseSnapshot } from './domain'

/** Approved 2026-09-04: 87 reviewed candidates minus 4 used in production.
 * Remove from new choices, never from historical snapshots or the full registry.
 * See docs/design/EXERCISE_CATALOG_RETIREMENT.md.
 */
export const RETIRED_SYSTEM_EXERCISE_REFS: ReadonlySet<string> = new Set([
  'fedb-atlas-stone-trainer', // Подъём тренировочного камня Атласа
  'fedb-atlas-stones', // Подъём камня Атласа
  'fedb-axle-deadlift', // Становая тяга с аксель-грифом
  'fedb-bear-crawl-sled-drags', // Медвежья ходьба с санями
  'fedb-car-deadlift', // Тяга автомобиля на раме (Car Deadlift)
  'fedb-circus-bell', // Жим цирковой гантели
  'fedb-conans-wheel', // Переноска «Колесо Конана»
  'fedb-crucifix', // Удержание веса в стороны
  'fedb-forward-drag-with-press', // Тяга саней вперёд с жимом
  'fedb-keg-load', // Подъём бочонка на платформу
  'fedb-log-lift', // Подъём и жим бревна
  'fedb-power-stairs', // Силовая лестница с грузом
  'fedb-rickshaw-carry', // Прогулка с рамой
  'fedb-rickshaw-deadlift', // Становая тяга с рамой
  'fedb-sandbag-load', // Подъём мешка на платформу
  'fedb-tire-flip', // Переворот покрышки
  'fedb-yoke-walk', // Прогулка с коромыслом
  'fedb-bench-press-with-chains', // Жим лёжа с цепями
  'fedb-floor-press-with-chains', // Жим с пола с цепями
  'fedb-board-press', // Жим с бруска
  'fedb-pin-presses', // Жим со стоек с ограниченной амплитудой
  'fedb-reverse-band-bench-press', // Жим лёжа с обратной резиной
  'fedb-box-squat-with-bands', // Присед на тумбу с резиной
  'fedb-box-squat-with-chains', // Присед на тумбу с цепями
  'fedb-deadlift-with-bands', // Становая тяга с резиной
  'fedb-deadlift-with-chains', // Становая тяга с цепями
  'fedb-rack-pull-with-bands', // Тяга с плинтов с резиной
  'fedb-reverse-band-deadlift', // Становая тяга с обратной резиной
  'fedb-good-morning-off-pins', // Гудмонинг со стоек
  'fedb-bench-press-with-bands', // Жим лёжа с резиной
  'fedb-reverse-band-box-squat', // Присед на тумбу с обратной резиной
  'fedb-reverse-band-power-squat', // Силовой присед с обратной резиной
  'fedb-reverse-band-sumo-deadlift', // Становая тяга сумо с обратной резиной
  'fedb-clean-deadlift', // Становая тяга для взятия на грудь (Clean Deadlift)
  'fedb-clean-from-blocks', // Взятие на грудь с блоков
  'fedb-clean-pull', // Тяга для взятия на грудь с подрывом (Clean Pull)
  'fedb-clean-shrug', // Шраги в тяге для взятия
  'fedb-hang-clean-below-the-knees', // Взятие на грудь с виса ниже колен
  'fedb-hang-snatch-below-knees', // Рывок с виса ниже колен
  'fedb-muscle-snatch', // Силовой рывок без подседа
  'fedb-power-clean-from-blocks', // Силовое взятие с блоков
  'fedb-power-snatch-from-blocks', // Силовой рывок с блоков
  'fedb-snatch-balance', // Рывковый уход в сед
  'fedb-snatch-deadlift', // Рывковая становая тяга (Snatch Deadlift)
  'fedb-snatch-from-blocks', // Рывок с блоков
  'fedb-snatch-pull', // Рывковая тяга с подрывом (Snatch Pull)
  'fedb-kettlebell-pirate-ships', // Маятник с гирей
  'fedb-extended-range-one-arm-kettlebell-floor-press', // Жим гири с пола одной рукой в увеличенной амплитуде
  'fedb-bottoms-up-clean-from-the-hang-position', // Взятие гири донышком вверх с виса
  'fedb-bent-press', // Жим гири в наклоне
  'fedb-double-kettlebell-snatch', // Рывок двух гирь
  'fedb-advanced-kettlebell-windmill', // Продвинутая «мельница» с гирей
  'fedb-leg-over-floor-press', // Жим гири с пола с переносом ноги
  'fedb-one-arm-kettlebell-para-press', // Пара-жим гири одной рукой
  'fedb-one-arm-kettlebell-military-press-to-the-side', // Жим гири одной рукой в сторону
  'fedb-one-arm-kettlebell-split-jerk', // Толчок гири в разножку
  'fedb-one-arm-kettlebell-split-snatch', // Рывок гири в разножку
  'fedb-one-arm-open-palm-kettlebell-clean', // Взятие гири открытой ладонью одной рукой
  'fedb-open-palm-kettlebell-clean', // Взятие гири открытой ладонью
  'fedb-plyo-kettlebell-pushups', // Плиометрические отжимания на гирях
  'fedb-calf-machine-shoulder-shrug', // Шраги в тренажёре для икр
  'fedb-barbell-incline-shoulder-raise', // Подъём плеч на наклонной
  'fedb-dumbbell-incline-shoulder-raise', // Подъём плеч с гантелями на наклонной
  'fedb-smith-machine-hang-power-clean', // Силовое взятие с виса в Смите
  'fedb-smith-machine-leg-press', // Жим ногами в Смите
  'fedb-lying-cambered-barbell-row', // Тяга изогнутого грифа лёжа
  'fedb-kneeling-jump-squat', // Прыжок из приседа с колен
  'fedb-cable-judo-flip', // Бросок дзюдо в блоке
  'fedb-bosu-ball-cable-crunch-with-side-bends', // Скручивания в блоке на босу с наклонами
  'fedb-front-raise-and-pullover', // Подъём вперёд с пуловером
  'fedb-gorilla-chin-crunch', // Подтягивание со скручиванием
  'fedb-press-sit-up', // Подъём корпуса с жимом штанги
  'fedb-iron-cross', // «Железный крест» с гантелями
  'fedb-clock-push-up', // Отжимания «по часам»
  'fedb-lunge-pass-through', // Выпад с передачей гири под ногой
  'fedb-kettlebell-seesaw-press', // Попеременный жим гирь «качели»
  'fedb-around-the-worlds', // Круговые разведения гантелей лёжа
  'fedb-vertical-swing', // Вертикальный мах гантелью
  'fedb-brachialis-smr', // Массаж плечевой мышцы на валике
  'fedb-decline-dumbbell-triceps-extension', // Разгибание гантелей на трицепс вниз головой
  'fedb-decline-ez-bar-triceps-extension', // Разгибание EZ-грифа на трицепс вниз головой
  'fedb-cable-seated-lateral-raise', // Разведение рук сидя в блоке
  'fedb-weighted-ball-hyperextension', // Гиперэкстензия на фитболе с весом
])

/** User-authored exercises are never retired by a system catalog decision. */
export function isActiveCatalogExercise(exercise: ExerciseSnapshot): boolean {
  return exercise.source === 'custom' || !RETIRED_SYSTEM_EXERCISE_REFS.has(exercise.ref)
}
