// Импортёр библиотеки упражнений из Free Exercise DB (yuhonas), лицензия
// Unlicense / public domain: https://github.com/yuhonas/free-exercise-db
//
// Отбирает ~120 популярных силовых упражнений с покрытием всех групп мышц,
// маппит детальные мышцы/оборудование в нашу модель, скачивает по одной
// картинке (JPG-фото позы) в public/exercises/ и генерирует
// src/shared/system-exercises.generated.ts.
//
// Запускать вручную: `node scripts/import-exercises.mjs`. Результат
// (сгенерированный .ts + картинки) коммитится в репозиторий.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { INSTRUCTIONS_RU } from './instructions-ru.mjs'

const SOURCE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const RAW_IMAGES = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const TARGET_COUNT = 185

// Обязательно включить в импорт (независимо от round-robin отбора). Например
// ягодичные — новую группу «Ягодицы» наполняем целенаправленно. Ключи — id из
// исходной Free Exercise DB; каждое должно иметь перевод в TRANSLATIONS.
const FORCE_INCLUDE = new Set([
  // Ягодицы.
  'Barbell_Glute_Bridge', 'Barbell_Hip_Thrust', 'Butt_Lift_Bridge',
  'Single_Leg_Glute_Bridge', 'One-Legged_Cable_Kickback',
  'Hip_Extension_with_Bands', 'Hip_Lift_with_Band', 'Kneeling_Squat',
  'Step-up_with_Knee_Raise', 'Physioball_Hip_Bridge', 'Leg_Lift',
  // Икры.
  'Barbell_Seated_Calf_Raise', 'Calf_Press', 'Calf_Press_On_The_Leg_Press_Machine',
  'Calf_Raises_-_With_Bands', 'Dumbbell_Seated_One-Leg_Calf_Raise',
  'Rocking_Standing_Calf_Raise', 'Seated_Calf_Raise', 'Smith_Machine_Calf_Raise',
  // Бицепс.
  'Alternate_Hammer_Curl', 'Alternate_Incline_Dumbbell_Curl',
  'Barbell_Curls_Lying_Against_An_Incline', 'Cable_Hammer_Curls_-_Rope_Attachment',
  'Cable_Preacher_Curl', 'Close-Grip_EZ_Bar_Curl', 'Close-Grip_EZ-Bar_Curl_with_Band',
  // Предплечья.
  'Cable_Wrist_Curl', 'Finger_Curls', 'Palms-Down_Dumbbell_Wrist_Curl_Over_A_Bench',
  'Palms-Down_Wrist_Curl_Over_A_Bench', 'Palms-Up_Barbell_Wrist_Curl_Over_A_Bench',
  'Palms-Up_Dumbbell_Wrist_Curl_Over_A_Bench',
  // Бицепс бедра.
  'Ball_Leg_Curl', 'Lying_Leg_Curls', 'Seated_Leg_Curl', 'Standing_Leg_Curl',
  'Stiff-Legged_Dumbbell_Deadlift', 'Dumbbell_Clean', 'Kettlebell_Dead_Clean',
  'Kettlebell_One-Legged_Deadlift',
  // Трапеции.
  'Barbell_Shrug', 'Barbell_Shrug_Behind_The_Back', 'Cable_Shrugs',
  'Calf-Machine_Shoulder_Shrug', 'Dumbbell_Shrug',
  // Широчайшие. (Chin-Up/Pullups — дубли нашего базового «Подтягивания», см. DEDUP_REFS.)
  'Cable_Incline_Pushdown', 'Rope_Straight-Arm_Pulldown',
  'Straight-Arm_Pulldown', 'Underhand_Cable_Pulldowns',
  // Середина спины. (Seated_Cable_Rows — дубль базового «Тяга нижнего блока».)
  'Incline_Bench_Pull', 'Lying_Cambered_Barbell_Row',
  'Smith_Machine_Bent_Over_Row', 'Straight_Bar_Bench_Mid_Rows',
  // Приводящие/отводящие.
  'Band_Hip_Adductions', 'Thigh_Adductor', 'Thigh_Abductor',
])

const projectRoot = new URL('..', import.meta.url)
const imagesDir = new URL('public/exercises/', projectRoot)
const generatedFile = new URL('src/shared/system-exercises.generated.ts', projectRoot)
const baseGeneratedFile = new URL('src/shared/system-exercises.base.generated.ts', projectRoot)

// Наши 49 базовых упражнений: ref -> аналог в Free Exercise DB (id) + русское
// имя в формате «Название (Оборудование)». Из аналога берём картинку,
// оборудование, детальную мышцу и инструкции — приводим базовые к тому же
// идеальному виду, что и импортированные. sourceId: null — аналога нет
// (кардио-тренажёры), картинки не будет, метаданные задаём вручную.
const BASE_MATCH = {
  'barbell-squat':       { id: 'Barbell_Squat', name: 'Присед со штангой (Штанга)' },
  'front-squat':         { id: 'Front_Barbell_Squat', name: 'Фронтальный присед (Штанга)' },
  'leg-press':           { id: 'Leg_Press', name: 'Жим ногами (Тренажёр)' },
  'romanian-deadlift':   { id: 'Romanian_Deadlift', name: 'Румынская тяга (Штанга)' },
  'stiff-leg-deadlift':  { id: 'Stiff-Legged_Barbell_Deadlift', name: 'Становая на прямых ногах (Штанга)' },
  'lunges':              { id: 'Barbell_Lunge', name: 'Выпады (Штанга)' },
  'bulgarian-split-squat': { id: 'One_Leg_Barbell_Squat', name: 'Болгарский присед (Штанга)' },
  'leg-curl':            { id: 'Lying_Leg_Curls', name: 'Сгибание ног лёжа (Тренажёр)' },
  'leg-extension':       { id: 'Leg_Extensions', name: 'Разгибание ног (Тренажёр)' },
  'calf-raise':          { id: 'Standing_Calf_Raises', name: 'Подъём на носки стоя (Тренажёр)' },
  'hyperextension':      { id: 'Hyperextensions_Back_Extensions', name: 'Гиперэкстензия (Своё тело)' },
  'bench-press':         { id: 'Barbell_Bench_Press_-_Medium_Grip', name: 'Жим лёжа (Штанга)' },
  'dumbbell-bench-press':{ id: 'Dumbbell_Bench_Press', name: 'Жим гантелей лёжа (Гантели)' },
  'incline-bench-press': { id: 'Barbell_Incline_Bench_Press_-_Medium_Grip', name: 'Жим на наклонной (Штанга)' },
  'dumbbell-fly':        { id: 'Dumbbell_Flyes', name: 'Разводка гантелей (Гантели)' },
  'push-ups':            { id: 'Pushups', name: 'Отжимания (Своё тело)' },
  'dips':                { id: 'Dips_-_Chest_Version', name: 'Отжимания на брусьях (Своё тело)' },
  'pec-deck':            { id: 'Butterfly', name: 'Сведение в тренажёре (Тренажёр)' },
  'barbell-row':         { id: 'Bent_Over_Barbell_Row', name: 'Тяга штанги в наклоне (Штанга)' },
  'dumbbell-row':        { id: 'One-Arm_Dumbbell_Row', name: 'Тяга гантели в наклоне (Гантели)' },
  'pull-ups':            { id: 'Pullups', name: 'Подтягивания (Своё тело)' },
  'lat-pulldown':        { id: 'Wide-Grip_Lat_Pulldown', name: 'Тяга верхнего блока (Блок)' },
  'seated-cable-row':    { id: 'Seated_Cable_Rows', name: 'Тяга нижнего блока (Блок)' },
  'deadlift':            { id: 'Barbell_Deadlift', name: 'Становая тяга (Штанга)' },
  'good-morning':        { id: 'Good_Morning', name: 'Гудмонинг (Штанга)' },
  'overhead-press':      { id: 'Standing_Military_Press', name: 'Жим штанги стоя (Штанга)' },
  'seated-dumbbell-press': { id: 'Dumbbell_Shoulder_Press', name: 'Жим гантелей сидя (Гантели)' },
  'lateral-raise':       { id: 'Side_Lateral_Raise', name: 'Разводка в стороны (Гантели)' },
  'rear-delt-fly':       { id: 'Reverse_Flyes', name: 'Разводка на заднюю дельту (Гантели)' },
  'upright-row':         { id: 'Upright_Barbell_Row', name: 'Тяга к подбородку (Штанга)' },
  'shrugs':              { id: 'Barbell_Shrug', name: 'Шраги (Штанга)' },
  'biceps-curl':         { id: 'Dumbbell_Bicep_Curl', name: 'Сгибание на бицепс (Гантели)' },
  'hammer-curl':         { id: 'Hammer_Curls', name: 'Молоток (Гантели)' },
  'barbell-curl':        { id: 'Barbell_Curl', name: 'Подъём штанги на бицепс (Штанга)' },
  'french-press':        { id: 'Lying_Triceps_Press', name: 'Французский жим (EZ-гриф)' },
  'triceps-pushdown':    { id: 'Triceps_Pushdown', name: 'Разгибание на трицепс (Блок)' },
  'close-grip-push-up':  { id: 'Push-Ups_-_Close_Triceps_Position', name: 'Отжимания узким хватом (Своё тело)' },
  'plank':               { id: 'Plank', name: 'Планка (Своё тело)' },
  'crunches':            { id: 'Crunches', name: 'Скручивания (Своё тело)' },
  'leg-raise':           { id: 'Flat_Bench_Lying_Leg_Raise', name: 'Подъём ног лёжа (Своё тело)' },
  'russian-twist':       { id: 'Russian_Twist', name: 'Русский твист (Своё тело)' },
  'side-plank':          { id: 'Side_Bridge', name: 'Боковая планка (Своё тело)' },
  'jump-rope':           { id: 'Rope_Jumping', name: 'Прыжки со скакалкой (Скакалка)' },
  // Кардио и берпи: точного аналога-упражнения в источнике нет, поэтому
  // метаданные (оборудование/мышца/инструкции) задаём вручную, но картинку
  // берём из близкого аналога (imageId) — Free Exercise DB, public domain.
  'running':             { id: null, imageId: 'Running_Treadmill', name: 'Бег (Кардио)', equipment: 'Кардио', detail: 'Кардио', instructions: ['Бегите в равномерном темпе, удерживая корпус прямым, руки согнуты под углом ~90°.', 'Дышите ритмично; контролируйте пульс по плану тренировки.'] },
  'stationary-bike':     { id: null, imageId: 'Bicycling_Stationary', name: 'Велотренажёр (Кардио)', equipment: 'Кардио', detail: 'Кардио', instructions: ['Настройте посадку и сопротивление под план.', 'Крутите педали в равномерном темпе, удерживая корпус стабильным.'] },
  'elliptical':          { id: null, imageId: 'Elliptical_Trainer', name: 'Эллипс (Кардио)', equipment: 'Кардио', detail: 'Кардио', instructions: ['Встаньте на платформы, возьмитесь за рукояти.', 'Двигайтесь плавно, согласуя движения рук и ног, без рывков.'] },
  'rowing-machine':      { id: null, imageId: 'Rowing_Stationary', name: 'Гребной тренажёр (Кардио)', equipment: 'Кардио', detail: 'Кардио', instructions: ['Оттолкнитесь ногами, затем подтяните рукоять к корпусу.', 'Вернитесь в исходное в обратном порядке: руки — корпус — ноги.'] },
  'walking':             { id: null, imageId: 'Walking_Treadmill', name: 'Ходьба (Кардио)', equipment: 'Кардио', detail: 'Кардио', instructions: ['Идите в заданном темпе, держите корпус прямым.', 'Контролируйте продолжительность и дистанцию по плану.'] },
  'burpees':             { id: null, imageId: 'Mountain_Climbers', name: 'Берпи (Своё тело)', equipment: 'Своё тело', detail: 'Кардио', instructions: ['Из положения стоя присядьте и поставьте ладони на пол.', 'Прыжком отведите ноги назад в упор лёжа, сделайте отжимание.', 'Прыжком верните ноги к рукам и выпрыгните вверх с хлопком над головой.'] },
}

// Детальная мышца Free Exercise DB -> наш укрупнённый MuscleGroup.
const MUSCLE_GROUP = {
  chest: 'chest',
  shoulders: 'shoulders', traps: 'shoulders', neck: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  lats: 'back', 'middle back': 'back', 'lower back': 'back',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'glutes', calves: 'legs', adductors: 'legs', abductors: 'legs',
  abdominals: 'core',
}
// Детальная мышца -> русский лейбл для карточки.
// Народные термины (как тренеры говорят клиентам): передняя/задняя поверхность
// бедра вместо квадрицепс/бицепс бедра и т.п. Пучки дельт / верх-низ груди —
// проставляются вручную через RECLASSIFY (источник их не различает).
const MUSCLE_LABEL = {
  chest: 'Грудь', shoulders: 'Плечи', traps: 'Трапеции', neck: 'Шея',
  biceps: 'Бицепс', triceps: 'Трицепс', forearms: 'Предплечья',
  lats: 'Широчайшие', 'middle back': 'Середина спины', 'lower back': 'Поясница',
  quadriceps: 'Передняя поверхность бедра', hamstrings: 'Задняя поверхность бедра', glutes: 'Ягодицы',
  calves: 'Икроножные', adductors: 'Внутренняя поверхность бедра', abductors: 'Наружная поверхность бедра', abdominals: 'Пресс',
}
// Ручные исправления классификации (ref -> переопределение группы/детали).
// Free Exercise DB иногда тегирует упражнение по вторичной мышце. Здесь
// правим по прайм-муверу (общепринятая спортивная анатомия). Применяется и к
// импортированным, и к базовым — переживает повторный импорт из БД.
const RECLASSIFY = {
  // Разгибание спины — прайм-мувер erector spinae (поясница), не ноги.
  hyperextension: { muscleGroup: 'back', primaryMuscleDetail: 'Поясница' },
  // Динамика на прямую мышцу живота + hip flexors, не ягодицы.
  'fedb-flutter-kicks': { muscleGroup: 'core', primaryMuscleDetail: 'Пресс' },
  // Пауэрлифт-жим / жим с цепями — грудной жим (не трицепс); деталь ниже в блоке груди.
  // Становая (hip hinge) — задняя цепь, прайм-мувер задняя поверхность бедра, не квадрицепс.
  'fedb-cable-deadlifts': { primaryMuscleDetail: 'Задняя поверхность бедра' },
  'fedb-leverage-deadlift': { primaryMuscleDetail: 'Задняя поверхность бедра' },
  // Гудмонинг в группе «Спина»: деталь = Поясница (как у варианта на прямых
  // ногах), иначе «Бицепс бедра» ошибочно всплывает подкатегорией «Спины».
  'good-morning': { primaryMuscleDetail: 'Поясница' },
  // Скакалка — кардио, деталь не «Квадрицепс».
  'jump-rope': { primaryMuscleDetail: 'Кардио' },

  // === Пучки дельт (плечи) — прайм-мувер, источник пучки не различает ===
  // Передняя дельта: жимы над головой, подъёмы вперёд.
  'overhead-press': { primaryMuscleDetail: 'Передняя дельта' },
  'seated-dumbbell-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-alternating-cable-shoulder-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-anti-gravity-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-bradford-rocky-presses': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-cable-shoulder-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-dumbbell-raise': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-kettlebell-pirate-ships': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-leverage-shoulder-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-machine-shoulder-military-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-seated-cable-shoulder-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-smith-machine-overhead-shoulder-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-standing-alternating-dumbbell-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-standing-bradford-press': { primaryMuscleDetail: 'Передняя дельта' },
  'fedb-barbell-incline-shoulder-raise': { primaryMuscleDetail: 'Передняя дельта' },
  // Средняя дельта: разводки в стороны, тяга к подбородку/к шее.
  'lateral-raise': { primaryMuscleDetail: 'Средняя дельта' },
  'upright-row': { primaryMuscleDetail: 'Средняя дельта' },
  'fedb-smith-machine-one-arm-upright-row': { primaryMuscleDetail: 'Средняя дельта' },
  'fedb-low-pulley-row-to-neck': { primaryMuscleDetail: 'Средняя дельта' },
  // Задняя дельта: разводки/тяги на заднюю дельту.
  'rear-delt-fly': { primaryMuscleDetail: 'Задняя дельта' },
  'fedb-barbell-rear-delt-row': { primaryMuscleDetail: 'Задняя дельта' },
  'fedb-cable-rope-rear-delt-rows': { primaryMuscleDetail: 'Задняя дельта' },
  // fedb-cable-internal-rotation — ротаторная манжета, не пучок дельты: оставляем «Плечи».

  // === Грудь: верх (наклон вверх) / низ (отрицательный наклон) / середина ===
  // Верх груди — положительный наклон (incline).
  'incline-bench-press': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-barbell-incline-bench-press-medium-grip': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-hammer-grip-incline-db-bench-press': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-cable-chest-press': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-dumbbell-bench-with-palms-facing-in': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-dumbbell-flyes': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-dumbbell-flyes-with-a-twist': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-dumbbell-press': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-push-up': { primaryMuscleDetail: 'Грудь (верх)' },
  'fedb-incline-push-up-medium': { primaryMuscleDetail: 'Грудь (верх)' },
  // Низ груди — отрицательный наклон (decline).
  'fedb-decline-barbell-bench-press': { primaryMuscleDetail: 'Грудь (низ)' },
  'fedb-decline-dumbbell-bench-press': { primaryMuscleDetail: 'Грудь (низ)' },
  'fedb-decline-dumbbell-flyes': { primaryMuscleDetail: 'Грудь (низ)' },
  'fedb-decline-smith-press': { primaryMuscleDetail: 'Грудь (низ)' },
  'dips': { primaryMuscleDetail: 'Грудь (низ)' },
  // Середина груди — горизонтальные жимы/разводки/отжимания.
  'bench-press': { primaryMuscleDetail: 'Грудь (середина)' },
  'dumbbell-bench-press': { primaryMuscleDetail: 'Грудь (середина)' },
  'dumbbell-fly': { primaryMuscleDetail: 'Грудь (середина)' },
  'push-ups': { primaryMuscleDetail: 'Грудь (середина)' },
  'pec-deck': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-alternating-floor-press': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-barbell-bench-press-medium-grip': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-cable-chest-press': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-bench-press-powerlifting': { muscleGroup: 'chest', primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-dumbbell-bench-press-with-neutral-grip': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-bench-press-with-chains': { muscleGroup: 'chest', primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-extended-range-one-arm-kettlebell-floor-press': { primaryMuscleDetail: 'Грудь (середина)' },
  'fedb-front-raise-and-pullover': { primaryMuscleDetail: 'Грудь (середина)' },
}
// Оборудование -> русский лейбл.
const EQUIPMENT_LABEL = {
  barbell: 'Штанга', dumbbell: 'Гантели', machine: 'Тренажёр', cable: 'Блок',
  kettlebells: 'Гири', bands: 'Резина', 'body only': 'Своё тело',
  'exercise ball': 'Фитбол', 'medicine ball': 'Медбол', 'foam roll': 'Валик',
  'e-z curl bar': 'EZ-гриф', other: 'Другое',
}
// Русские названия импортированных упражнений (ref -> имя в формате
// «Упражнение (Оборудование)», сверено с общепринятой терминологией).
// Упражнения, отсутствующие здесь, в каталог не попадают — так набор
// стабилен и полностью переведён.
const TRANSLATIONS = {
  // Ягодичные (группа «Ягодицы»).
  'fedb-barbell-glute-bridge': 'Ягодичный мостик со штангой (Штанга)',
  'fedb-barbell-hip-thrust': 'Ягодичный мост со штангой (Штанга)',
  'fedb-butt-lift-bridge': 'Ягодичный мостик (Своё тело)',
  'fedb-single-leg-glute-bridge': 'Ягодичный мостик на одной ноге (Своё тело)',
  'fedb-one-legged-cable-kickback': 'Махи ногой назад в блоке (Блок)',
  'fedb-hip-extension-with-bands': 'Разгибание бедра с резиной (Резина)',
  'fedb-hip-lift-with-band': 'Подъём таза с резиной (Резина)',
  'fedb-kneeling-squat': 'Присед с колен со штангой (Штанга)',
  'fedb-step-up-with-knee-raise': 'Зашагивание с подъёмом колена (Своё тело)',
  'fedb-physioball-hip-bridge': 'Ягодичный мостик на фитболе (Фитбол)',
  'fedb-leg-lift': 'Подъём ноги назад (Своё тело)',
  // Икры.
  'fedb-barbell-seated-calf-raise': 'Подъём на носки сидя со штангой (Штанга)',
  'fedb-calf-press': 'Жим носками в тренажёре (Тренажёр)',
  'fedb-calf-press-on-the-leg-press-machine': 'Жим носками в жиме ногами (Тренажёр)',
  'fedb-calf-raises-with-bands': 'Подъём на носки с резиной (Резина)',
  'fedb-dumbbell-seated-one-leg-calf-raise': 'Подъём на носок сидя на одной ноге с гантелью (Гантели)',
  'fedb-rocking-standing-calf-raise': 'Подъём на носки стоя со штангой (Штанга)',
  'fedb-seated-calf-raise': 'Подъём на носки сидя в тренажёре (Тренажёр)',
  'fedb-smith-machine-calf-raise': 'Подъём на носки в Смите (Тренажёр)',
  // Бицепс.
  'fedb-alternate-hammer-curl': 'Попеременный молоток (Гантели)',
  'fedb-alternate-incline-dumbbell-curl': 'Попеременный подъём на бицепс на наклонной (Гантели)',
  'fedb-barbell-curls-lying-against-an-incline': 'Подъём штанги на бицепс лёжа на наклонной (Штанга)',
  'fedb-cable-hammer-curls-rope-attachment': 'Молоток на блоке с канатом (Блок)',
  'fedb-cable-preacher-curl': 'Подъём на бицепс на скамье Скотта в блоке (Блок)',
  'fedb-close-grip-ez-bar-curl': 'Подъём на бицепс узким хватом (EZ-гриф)',
  'fedb-close-grip-ez-bar-curl-with-band': 'Подъём на бицепс узким хватом с резиной (EZ-гриф)',
  // Предплечья.
  'fedb-cable-wrist-curl': 'Сгибание запястий в блоке (Блок)',
  'fedb-finger-curls': 'Сгибание пальцами со штангой (Штанга)',
  'fedb-palms-down-dumbbell-wrist-curl-over-a-bench': 'Разгибание запястий с гантелями на скамье (Гантели)',
  'fedb-palms-down-wrist-curl-over-a-bench': 'Разгибание запястий со штангой на скамье (Штанга)',
  'fedb-palms-up-barbell-wrist-curl-over-a-bench': 'Сгибание запястий со штангой на скамье (Штанга)',
  'fedb-palms-up-dumbbell-wrist-curl-over-a-bench': 'Сгибание запястий с гантелями на скамье (Гантели)',
  // Бицепс бедра.
  'fedb-ball-leg-curl': 'Сгибание ног на фитболе (Фитбол)',
  'fedb-lying-leg-curls': 'Сгибание ног лёжа в тренажёре (Тренажёр)',
  'fedb-seated-leg-curl': 'Сгибание ног сидя в тренажёре (Тренажёр)',
  'fedb-standing-leg-curl': 'Сгибание ноги стоя в тренажёре (Тренажёр)',
  'fedb-stiff-legged-dumbbell-deadlift': 'Становая на прямых ногах с гантелями (Гантели)',
  'fedb-dumbbell-clean': 'Взятие гантелей на грудь (Гантели)',
  'fedb-kettlebell-dead-clean': 'Взятие гири на грудь с пола (Гиря)',
  'fedb-kettlebell-one-legged-deadlift': 'Становая на одной ноге с гирей (Гиря)',
  // Трапеции.
  'fedb-barbell-shrug': 'Шраги со штангой (Штанга)',
  'fedb-barbell-shrug-behind-the-back': 'Шраги со штангой за спиной (Штанга)',
  'fedb-cable-shrugs': 'Шраги в блоке (Блок)',
  'fedb-calf-machine-shoulder-shrug': 'Шраги в тренажёре для икр (Тренажёр)',
  'fedb-dumbbell-shrug': 'Шраги с гантелями (Гантели)',
  // Широчайшие.
  'fedb-cable-incline-pushdown': 'Пуловер прямыми руками в наклоне в блоке (Блок)',
  'fedb-rope-straight-arm-pulldown': 'Пуловер прямыми руками с канатом в блоке (Блок)',
  'fedb-straight-arm-pulldown': 'Пуловер прямыми руками в блоке (Блок)',
  'fedb-underhand-cable-pulldowns': 'Тяга верхнего блока обратным хватом (Блок)',
  // Середина спины.
  'fedb-incline-bench-pull': 'Тяга штанги лёжа на наклонной (Штанга)',
  'fedb-lying-cambered-barbell-row': 'Тяга изогнутого грифа лёжа (Штанга)',
  'fedb-smith-machine-bent-over-row': 'Тяга в наклоне в Смите (Тренажёр)',
  'fedb-straight-bar-bench-mid-rows': 'Тяга к скамье прямым грифом сидя (Штанга)',
  // Приводящие / отводящие.
  'fedb-band-hip-adductions': 'Приведение бедра с резиной (Резина)',
  'fedb-thigh-adductor': 'Сведение ног в тренажёре (Тренажёр)',
  'fedb-thigh-abductor': 'Разведение ног в тренажёре (Тренажёр)',
  'fedb-3-4-sit-up': 'Подъём корпуса на 3/4 (Своё тело)',
  'fedb-alternating-cable-shoulder-press': 'Попеременный жим над головой (Блок)',
  'fedb-alternating-floor-press': 'Попеременный жим с пола (Гиря)',
  'fedb-barbell-side-split-squat': 'Боковой сплит-присед (Штанга)',
  'fedb-bench-dips': 'Обратные отжимания от скамьи (Своё тело)',
  'fedb-bent-over-barbell-row': 'Тяга штанги в наклоне (Штанга)',
  'fedb-air-bike': 'Велосипед лёжа (Своё тело)',
  'fedb-anti-gravity-press': 'Антигравитационный жим (Штанга)',
  'fedb-barbell-bench-press-medium-grip': 'Жим лёжа средним хватом (Штанга)',
  'fedb-close-grip-barbell-bench-press': 'Жим лёжа узким хватом (Штанга)',
  'fedb-bent-over-one-arm-long-bar-row': 'Тяга Т-грифа одной рукой в наклоне (Штанга)',
  'fedb-bent-knee-hip-raise': 'Подъём таза с согнутыми коленями (Своё тело)',
  'fedb-barbell-incline-shoulder-raise': 'Подъём плеч на наклонной (Штанга)',
  'fedb-barbell-incline-bench-press-medium-grip': 'Жим на наклонной средним хватом (Штанга)',
  'fedb-barbell-walking-lunge': 'Выпады в ходьбе (Штанга)',
  'fedb-close-grip-dumbbell-press': 'Жим гантелей узким хватом (Гантели)',
  'fedb-bent-over-two-dumbbell-row': 'Тяга двух гантелей в наклоне (Гантели)',
  'fedb-bottoms-up': 'Подъём таза лёжа (Своё тело)',
  'fedb-barbell-rear-delt-row': 'Тяга на заднюю дельту в наклоне (Штанга)',
  'fedb-cable-chest-press': 'Жим от груди в кроссовере (Блок)',
  'fedb-bodyweight-squat': 'Приседания без веса (Своё тело)',
  'fedb-dip-machine': 'Отжимания в тренажёре (Тренажёр)',
  'fedb-bent-over-two-dumbbell-row-with-palms-in': 'Тяга гантелей в наклоне нейтральным хватом (Гантели)',
  'fedb-butt-ups': 'Подъём таза с прямыми ногами (Своё тело)',
  'fedb-bradford-rocky-presses': 'Жим Брэдфорда (Штанга)',
  'fedb-decline-barbell-bench-press': 'Жим на скамье с отрицательным наклоном (Штанга)',
  'fedb-cable-deadlifts': 'Становая тяга в блоке (Блок)',
  'fedb-dips-triceps-version': 'Отжимания на брусьях (трицепс) (Своё тело)',
  'fedb-cable-judo-flip': 'Бросок дзюдо в блоке (Блок)',
  'fedb-cable-internal-rotation': 'Внутренняя ротация плеча в блоке (Блок)',
  'fedb-decline-dumbbell-bench-press': 'Жим гантелей на скамье с отрицательным наклоном (Гантели)',
  'fedb-chair-squat': 'Приседания к стулу (Тренажёр)',
  'fedb-incline-push-up-close-grip': 'Отжимания на возвышении узким хватом (Своё тело)',
  'fedb-close-grip-front-lat-pulldown': 'Тяга верхнего блока узким хватом (Блок)',
  'fedb-cable-russian-twists': 'Русский твист в блоке (Блок)',
  'fedb-cable-rope-rear-delt-rows': 'Тяга каната на заднюю дельту (Блок)',
  'fedb-decline-dumbbell-flyes': 'Разводка гантелей на отрицательном наклоне (Гантели)',
  'fedb-dumbbell-lunges': 'Выпады с гантелями (Гантели)',
  'fedb-jm-press': 'Жим Джей-Эм (Штанга)',
  'fedb-dumbbell-incline-row': 'Тяга гантелей лёжа на наклонной (Гантели)',
  'fedb-cocoons': 'Складка лёжа «кокон» (Своё тело)',
  'fedb-cable-shoulder-press': 'Жим над головой в блоке (Блок)',
  'fedb-decline-smith-press': 'Жим в Смите на отрицательном наклоне (Тренажёр)',
  'fedb-dumbbell-squat': 'Приседания с гантелями (Гантели)',
  'fedb-smith-machine-close-grip-bench-press': 'Жим узким хватом в Смите (Тренажёр)',
  'fedb-kneeling-high-pulley-row': 'Тяга верхнего блока с колен (Блок)',
  'fedb-cross-body-crunch': 'Косые скручивания (Своё тело)',
  'fedb-dumbbell-raise': 'Подъём гантелей вперёд (Гантели)',
  'fedb-flutter-kicks': 'Ножницы (Своё тело)',
  'fedb-bench-press-powerlifting': 'Жим лёжа (пауэрлифтинг) (Штанга)',
  'fedb-kneeling-single-arm-high-pulley-row': 'Тяга верхнего блока одной рукой с колен (Блок)',
  'fedb-dead-bug': 'Упражнение «мёртвый жук» (Своё тело)',
  'fedb-kettlebell-pirate-ships': 'Маятник с гирей (Гиря)',
  'fedb-dumbbell-bench-press-with-neutral-grip': 'Жим гантелей нейтральным хватом (Гантели)',
  'fedb-glute-kickback': 'Махи ногой назад (Своё тело)',
  'fedb-bench-press-with-chains': 'Жим лёжа с цепями (Штанга)',
  'fedb-leverage-high-row': 'Верхняя тяга в рычажном тренажёре (Тренажёр)',
  'fedb-decline-oblique-crunch': 'Косые скручивания на отрицательном наклоне (Своё тело)',
  'fedb-leverage-shoulder-press': 'Жим над головой в рычажном тренажёре (Тренажёр)',
  'fedb-extended-range-one-arm-kettlebell-floor-press': 'Жим гири с пола одной рукой (Гиря)',
  'fedb-goblet-squat': 'Гоблет-присед (Гиря)',
  'fedb-board-press': 'Жим с бруска (Штанга)',
  'fedb-leverage-iso-row': 'Горизонтальная тяга в рычажном тренажёре (Тренажёр)',
  'fedb-decline-reverse-crunch': 'Обратные скручивания на отрицательном наклоне (Своё тело)',
  'fedb-low-pulley-row-to-neck': 'Тяга нижнего блока к шее (Блок)',
  'fedb-front-raise-and-pullover': 'Подъём вперёд с пуловером (Штанга)',
  'fedb-hack-squat': 'Гакк-присед (Тренажёр)',
  'fedb-bottoms-up-clean-from-the-hang-position': 'Взятие гири донышком вверх с виса (Гиря)',
  'fedb-one-arm-lat-pulldown': 'Тяга верхнего блока одной рукой (Блок)',
  'fedb-elbow-to-knee': 'Скручивания локоть к колену (Своё тело)',
  'fedb-machine-shoulder-military-press': 'Армейский жим в тренажёре (Тренажёр)',
  'fedb-hammer-grip-incline-db-bench-press': 'Жим гантелей на наклонной нейтральным хватом (Гантели)',
  'fedb-close-grip-push-up-off-of-a-dumbbell': 'Отжимания узким хватом на гантелях (Своё тело)',
  'fedb-one-arm-dumbbell-row': 'Тяга гантели одной рукой (Гантели)',
  'fedb-flat-bench-leg-pull-in': 'Подтягивание ног лёжа на скамье (Своё тело)',
  'fedb-seated-cable-shoulder-press': 'Жим над головой сидя в блоке (Блок)',
  'fedb-incline-cable-chest-press': 'Жим на наклонной в кроссовере (Блок)',
  'fedb-leverage-deadlift': 'Становая тяга в рычажном тренажёре (Тренажёр)',
  'fedb-decline-close-grip-bench-to-skull-crusher': 'Французский жим узким хватом на наклоне (Штанга)',
  'fedb-one-arm-long-bar-row': 'Тяга Т-грифа одной рукой (Штанга)',
  'fedb-jackknife-sit-up': 'Складка «складной нож» (Своё тело)',
  'fedb-incline-dumbbell-bench-with-palms-facing-in': 'Жим гантелей на наклонной ладонями внутрь (Гантели)',
  'fedb-plie-dumbbell-squat': 'Присед плие с гантелью (Гантели)',
  'fedb-drag-curl': 'Протягивающий подъём на бицепс (Штанга)',
  'fedb-landmine-180s': 'Повороты «180» с грифом (Штанга)',
  'fedb-smith-machine-one-arm-upright-row': 'Тяга к подбородку одной рукой в Смите (Тренажёр)',
  'fedb-incline-dumbbell-flyes': 'Разводка гантелей на наклонной (Гантели)',
  'fedb-pull-through': 'Протяжка между ног в блоке (Блок)',
  'fedb-dumbbell-floor-press': 'Жим гантелей с пола (Гантели)',
  'fedb-leg-pull-in': 'Подтягивание ног лёжа (Своё тело)',
  'fedb-smith-machine-overhead-shoulder-press': 'Жим над головой в Смите (Тренажёр)',
  'fedb-incline-dumbbell-flyes-with-a-twist': 'Разводка гантелей на наклонной с поворотом (Гантели)',
  'fedb-smith-machine-squat': 'Приседания в Смите (Тренажёр)',
  'fedb-floor-press': 'Жим с пола (Штанга)',
  'fedb-shotgun-row': 'Тяга одной рукой в блоке (Блок)',
  'fedb-pallof-press-with-rotation': 'Жим Паллоффа с поворотом (Блок)',
  'fedb-smith-machine-upright-row': 'Тяга к подбородку в Смите (Тренажёр)',
  'fedb-incline-dumbbell-press': 'Жим гантелей на наклонной (Гантели)',
  'fedb-smith-machine-stiff-legged-deadlift': 'Становая на прямых ногах в Смите (Тренажёр)',
  'fedb-floor-press-with-chains': 'Жим с пола с цепями (Штанга)',
  'fedb-smith-machine-bent-over-row': 'Тяга в наклоне в Смите (Тренажёр)',
  'fedb-seated-flat-bench-leg-pull-in': 'Подтягивание ног сидя на скамье (Своё тело)',
  'fedb-standing-alternating-dumbbell-press': 'Попеременный жим гантелей стоя (Гантели)',
  'fedb-incline-push-up': 'Отжимания на возвышении (Своё тело)',
  'fedb-smith-single-leg-split-squat': 'Сплит-присед на одной ноге в Смите (Тренажёр)',
  'fedb-high-cable-curls': 'Подъём на бицепс в верхнем блоке (Блок)',
  'fedb-stiff-leg-barbell-good-morning': 'Гудмонинг на прямых ногах (Штанга)',
  'fedb-side-jackknife': 'Боковая складка (Своё тело)',
  'fedb-standing-bradford-press': 'Жим Брэдфорда стоя (Штанга)',
  'fedb-incline-push-up-medium': 'Отжимания на среднем возвышении (Своё тело)',
  'fedb-split-squat-with-dumbbells': 'Сплит-присед с гантелями (Гантели)',
  'fedb-one-arm-floor-press': 'Жим с пола одной рукой (Штанга)',
  'fedb-straight-bar-bench-mid-rows': 'Тяга к скамье прямым грифом (Штанга)',
}

// Импортированные, дублирующие наши 49 базовых (наши приоритетнее): исключаем.
const DEDUP_REFS = new Set([
  'fedb-barbell-squat',        // = barbell-squat (Присед со штангой)
  'fedb-leg-press',            // = leg-press (Жим ногами)
  'fedb-dumbbell-bench-press', // = dumbbell-bench-press (Жим гантелей лёжа)
  'fedb-seated-cable-rows',    // = seated-cable-row (Тяга нижнего блока)
  'fedb-seated-dumbbell-press',// = seated-dumbbell-press (Жим гантелей сидя)
  'fedb-chin-up',              // = pull-ups (Подтягивания)
  'fedb-pullups',              // = pull-ups (Подтягивания)
  'fedb-barbell-curl',         // = barbell-curl (Подъём штанги на бицепс)
])

// category Free Exercise DB -> наш inputKind.
function inputKindFor(category) {
  if (category === 'cardio') return 'distance'
  if (category === 'stretching') return 'reps'
  return 'strength'
}

function muscleGroupFor(detail) {
  return MUSCLE_GROUP[detail] ?? 'other'
}
function muscleLabelFor(detail) {
  return MUSCLE_LABEL[detail] ?? detail
}
function equipmentLabelFor(equipment) {
  return EQUIPMENT_LABEL[equipment] ?? 'Другое'
}

// Приоритет отбора: базовые силовые, распространённое оборудование.
const GOOD_EQUIPMENT = new Set(['barbell', 'dumbbell', 'machine', 'cable', 'body only', 'kettlebells'])
function score(ex) {
  let s = 0
  if (ex.category === 'strength' || ex.category === 'powerlifting') s += 3
  if (GOOD_EQUIPMENT.has(ex.equipment)) s += 2
  if (ex.mechanic === 'compound') s += 2
  if (ex.level === 'beginner') s += 1
  return s
}

async function main() {
  console.log('Загружаю базу упражнений...')
  const all = await (await fetch(SOURCE)).json()
  const byId = Object.fromEntries(all.map((ex) => [ex.id, ex]))

  // Отбираем ~TARGET_COUNT популярных с балансом по группам мышц: сортируем по
  // score, затем round-robin по группам, чтобы ни одна не была пустой.
  const usable = all.filter((ex) => ex.images?.length && ex.primaryMuscles?.length && ex.equipment)
  usable.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))

  const byGroup = new Map()
  for (const ex of usable) {
    const group = muscleGroupFor(ex.primaryMuscles[0])
    if (!byGroup.has(group)) byGroup.set(group, [])
    byGroup.get(group).push(ex)
  }
  const groups = [...byGroup.keys()]
  const picked = []
  const seen = new Set()
  // Сначала — обязательные (FORCE_INCLUDE), затем добор round-robin до TARGET_COUNT.
  for (const ex of usable) {
    if (FORCE_INCLUDE.has(ex.id) && !seen.has(ex.id)) { seen.add(ex.id); picked.push(ex) }
  }
  let round = 0
  while (picked.length < TARGET_COUNT) {
    let addedThisRound = false
    for (const group of groups) {
      const list = byGroup.get(group)
      if (round < list.length) {
        const ex = list[round]
        if (!seen.has(ex.id)) { seen.add(ex.id); picked.push(ex); addedThisRound = true }
        if (picked.length >= TARGET_COUNT) break
      }
    }
    if (!addedThisRound) break
    round++
  }

  console.log(`Отобрано ${picked.length} упражнений. Скачиваю картинки...`)
  await mkdir(fileURLToPath(imagesDir), { recursive: true })

  const rows = []
  for (const ex of picked) {
    const ref = `fedb-${ex.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    // Дубли наших базовых — пропускаем. Названия берём из словаря перевода;
    // если перевода нет — это новое упражнение вне набора, пропускаем.
    if (DEDUP_REFS.has(ref)) continue
    const name = TRANSLATIONS[ref]
    if (!name) { console.warn(`  нет перевода, пропуск: ${ref} (${ex.name})`); continue }

    const imageName = `${ref}.jpg`
    const response = await fetch(RAW_IMAGES + ex.images[0])
    if (!response.ok) { console.warn(`  пропуск (нет картинки): ${ex.name}`); continue }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(new URL(imageName, imagesDir), buffer)

    const detail = ex.primaryMuscles[0]
    const secondary = (ex.secondaryMuscles ?? []).map(muscleLabelFor)
    const fix = RECLASSIFY[ref] ?? {}
    rows.push({
      source: 'system',
      ref,
      name,
      muscleGroup: fix.muscleGroup ?? muscleGroupFor(detail),
      inputKind: inputKindFor(ex.category),
      equipment: equipmentLabelFor(ex.equipment),
      equipmentRef: ex.equipment,
      primaryMuscleDetail: fix.primaryMuscleDetail ?? muscleLabelFor(detail),
      secondaryMuscles: secondary,
      level: ex.level ?? null,
      imageUrl: `/exercises/${imageName}`,
      instructions: INSTRUCTIONS_RU[ref] ?? ex.instructions ?? [],
    })
  }

  const header = `// АВТОГЕНЕРАЦИЯ — не редактировать вручную.\n` +
    `// Источник: Free Exercise DB (yuhonas), лицензия Unlicense / public domain.\n` +
    `// Обновление: node scripts/import-exercises.mjs\n` +
    `import type { ImportedExercise } from './system-exercises'\n\n` +
    `export const IMPORTED_EXERCISES: readonly ImportedExercise[] = ${JSON.stringify(rows, null, 2)}\n`
  await writeFile(fileURLToPath(generatedFile), header)
  console.log(`Готово: ${rows.length} упражнений, картинки в public/exercises/, данные в system-exercises.generated.ts`)

  await generateBase(byId)
}

// Обогащает наши 49 базовых до идеального вида: картинка/оборудование/детальная
// мышца/инструкции из аналога Free Exercise DB, имя в формате «(Оборудование)».
// muscleGroup/inputKind берём из исходного каталога (не меняем семантику).
async function generateBase(byId) {
  const baseCatalog = await loadBaseCatalog()
  const rows = []
  for (const base of baseCatalog) {
    const match = BASE_MATCH[base.ref]
    if (!match) { console.warn(`  базовый без маппинга: ${base.ref}`); rows.push(base); continue }

    const fix = RECLASSIFY[base.ref] ?? {}
    const row = {
      source: 'system',
      ref: base.ref,
      name: match.name,
      muscleGroup: fix.muscleGroup ?? base.muscleGroup,
      inputKind: base.inputKind,
    }
    if (match.id) {
      const ex = byId[match.id]
      if (!ex) { console.warn(`  аналог не найден: ${base.ref} -> ${match.id}`); rows.push(base); continue }
      const imageName = `base-${base.ref}.jpg`
      const response = await fetch(RAW_IMAGES + ex.images[0])
      if (response.ok) {
        await writeFile(new URL(imageName, imagesDir), Buffer.from(await response.arrayBuffer()))
        row.imageUrl = `/exercises/${imageName}`
      } else {
        console.warn(`  нет картинки: ${base.ref}`)
      }
      row.equipment = equipmentLabelFor(ex.equipment)
      row.equipmentRef = ex.equipment
      row.primaryMuscleDetail = fix.primaryMuscleDetail ?? muscleLabelFor(ex.primaryMuscles[0])
      row.secondaryMuscles = (ex.secondaryMuscles ?? []).map(muscleLabelFor)
      row.level = ex.level ?? null
      row.instructions = INSTRUCTIONS_RU[base.ref] ?? ex.instructions ?? []
    } else {
      // Кардио/берпи: метаданные из маппинга. Картинку берём из близкого
      // аналога (match.imageId), если задан.
      row.equipment = match.equipment
      row.equipmentRef = 'other'
      row.primaryMuscleDetail = match.detail
      row.secondaryMuscles = []
      row.level = 'beginner'
      row.instructions = INSTRUCTIONS_RU[base.ref] ?? match.instructions
      if (match.imageId) {
        const source = byId[match.imageId]
        const imageName = `base-${base.ref}.jpg`
        const response = source && await fetch(RAW_IMAGES + source.images[0])
        if (response && response.ok) {
          await writeFile(new URL(imageName, imagesDir), Buffer.from(await response.arrayBuffer()))
          row.imageUrl = `/exercises/${imageName}`
        } else {
          console.warn(`  нет картинки-аналога: ${base.ref} (${match.imageId})`)
        }
      }
    }
    rows.push(row)
  }

  const header = `// АВТОГЕНЕРАЦИЯ — не редактировать вручную.\n` +
    `// Базовые упражнения, обогащённые из Free Exercise DB (public domain).\n` +
    `// Обновление: node scripts/import-exercises.mjs\n` +
    `import type { ExerciseSnapshot } from './domain'\n\n` +
    `export const BASE_EXERCISES: readonly ExerciseSnapshot[] = ${JSON.stringify(rows, null, 2)}\n`
  await writeFile(fileURLToPath(baseGeneratedFile), header)
  const withImg = rows.filter((r) => r.imageUrl).length
  console.log(`Базовые: ${rows.length} упражнений (${withImg} с картинками), данные в system-exercises.base.generated.ts`)
}

// Читает ref/name/muscleGroup/inputKind рукописных базовых из system-exercises.ts.
async function loadBaseCatalog() {
  const source = await (await import('node:fs/promises')).readFile(
    fileURLToPath(new URL('src/shared/system-exercises.ts', projectRoot)), 'utf8')
  const block = source.slice(source.indexOf('SYSTEM_EXERCISES = ['), source.indexOf('] as const'))
  const rows = []
  const re = /ref: '([^']+)', name: '([^']+)', muscleGroup: '([^']+)', inputKind: '([^']+)'/g
  let m
  while ((m = re.exec(block))) rows.push({ source: 'system', ref: m[1], name: m[2], muscleGroup: m[3], inputKind: m[4] })
  return rows
}

main().catch((error) => { console.error(error); process.exit(1) })
