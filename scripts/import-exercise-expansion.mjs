// Третья ступень каталога: 120 отобранных упражнений из Free Exercise DB.
// Источник: https://github.com/yuhonas/free-exercise-db (Unlicense / public domain).
//
// Набор отделён от основного импорта, чтобы расширение не меняло ref и порядок
// уже опубликованных 451 упражнений. Скрипт скачивает два фото техники и
// генерирует типизированный каталог с русскими названиями и подсказками.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const RAW_IMAGES = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const projectRoot = new URL('..', import.meta.url)
const imagesDir = new URL('public/exercises/', projectRoot)
const generatedFile = new URL('src/shared/system-exercises.expansion.generated.ts', projectRoot)

// Имена намеренно короткие и тренерские. В каталог не включаем близкие дубли
// базовых упражнений и карточек Vital (в частности, отдельный Stairmaster).
const EXPANSION = [
  // Кардио — 3.
  ['Prowler_Sprint', 'Спринт с силовыми санями (Сани)'],
  ['Recumbent_Bike', 'Горизонтальный велотренажёр (Тренажёр)'],
  ['Skating', 'Конькобежный бег (Своё тело)'],

  // Стронгмен и переносы — 18.
  ['Atlas_Stone_Trainer', 'Подъём тренировочного камня Атласа (Другое)'],
  ['Atlas_Stones', 'Подъём камня Атласа (Другое)'],
  ['Axle_Deadlift', 'Становая тяга с аксель-грифом (Другое)'],
  ['Bear_Crawl_Sled_Drags', 'Медвежья ходьба с санями (Сани)'],
  ['Car_Deadlift', 'Становая тяга в рычажном тренажёре (Тренажёр)'],
  ['Circus_Bell', 'Жим цирковой гантели (Другое)'],
  ['Conans_Wheel', 'Переноска «Колесо Конана» (Другое)'],
  ['Crucifix', 'Удержание веса в стороны (Другое)'],
  ['Forward_Drag_with_Press', 'Тяга саней вперёд с жимом (Сани)'],
  ['Keg_Load', 'Подъём бочонка на платформу (Другое)'],
  ['Log_Lift', 'Подъём и жим бревна (Другое)'],
  ['Power_Stairs', 'Силовая лестница с грузом (Другое)'],
  ['Rickshaw_Carry', 'Прогулка с рамой (Другое)'],
  ['Rickshaw_Deadlift', 'Становая тяга с рамой (Другое)'],
  ['Sandbag_Load', 'Подъём мешка на платформу (Мешок)'],
  ['Sled_Drag_-_Harness', 'Тяга саней в упряжи (Сани)'],
  ['Tire_Flip', 'Переворот покрышки (Покрышка)'],
  ['Yoke_Walk', 'Прогулка с коромыслом (Другое)'],

  // Тяжёлая атлетика — 24.
  ['Clean', 'Взятие штанги на грудь (Штанга)'],
  ['Clean_and_Jerk', 'Толчок штанги (Штанга)'],
  ['Clean_Deadlift', 'Тяга для взятия на грудь (Штанга)'],
  ['Clean_from_Blocks', 'Взятие на грудь с блоков (Штанга)'],
  ['Clean_Pull', 'Тяга штанги для взятия (Штанга)'],
  ['Clean_Shrug', 'Шраги в тяге для взятия (Штанга)'],
  ['Frankenstein_Squat', 'Присед Франкенштейна (Штанга)'],
  ['Hang_Clean', 'Взятие на грудь с виса (Штанга)'],
  ['Hang_Clean_-_Below_the_Knees', 'Взятие на грудь с виса ниже колен (Штанга)'],
  ['Hang_Snatch', 'Рывок с виса (Штанга)'],
  ['Hang_Snatch_-_Below_Knees', 'Рывок с виса ниже колен (Штанга)'],
  ['Muscle_Snatch', 'Силовой рывок без подседа (Штанга)'],
  ['Overhead_Squat', 'Присед со штангой над головой (Штанга)'],
  ['Power_Clean_from_Blocks', 'Силовое взятие с блоков (Штанга)'],
  ['Power_Jerk', 'Силовой швунг (Штанга)'],
  ['Power_Snatch', 'Силовой рывок (Штанга)'],
  ['Power_Snatch_from_Blocks', 'Силовой рывок с блоков (Штанга)'],
  ['Push_Press', 'Жимовой швунг (Штанга)'],
  ['Romanian_Deadlift_from_Deficit', 'Румынская тяга с возвышения (Штанга)'],
  ['Snatch', 'Рывок штанги (Штанга)'],
  ['Snatch_Balance', 'Рывковый уход в сед (Штанга)'],
  ['Snatch_Deadlift', 'Рывковая тяга (Штанга)'],
  ['Snatch_from_Blocks', 'Рывок с блоков (Штанга)'],
  ['Split_Jerk', 'Толчок в ножницы (Штанга)'],

  // Плиометрика и координация — 24.
  ['Backward_Medicine_Ball_Throw', 'Бросок медбола назад через голову (Медбол)'],
  ['Bench_Sprint', 'Быстрые зашагивания на скамью (Скамья)'],
  ['Box_Skip', 'Прыжковые зашагивания на тумбу (Тумба)'],
  ['Depth_Jump_Leap', 'Прыжок в глубину с выпрыгиванием (Тумба)'],
  ['Double_Leg_Butt_Kick', 'Прыжок с захлёстом двух ног (Своё тело)'],
  ['Fast_Skipping', 'Быстрые прыжки на месте (Своё тело)'],
  ['Front_Box_Jump', 'Запрыгивание на тумбу (Тумба)'],
  ['Hurdle_Hops', 'Прыжки через барьеры (Барьеры)'],
  ['Knee_Tuck_Jump', 'Прыжок с подтягиванием коленей (Своё тело)'],
  ['Lateral_Bound', 'Боковые прыжки с ноги на ногу (Своё тело)'],
  ['Lateral_Box_Jump', 'Боковое запрыгивание на тумбу (Тумба)'],
  ['Lateral_Cone_Hops', 'Боковые прыжки через конусы (Конусы)'],
  ['Medicine_Ball_Full_Twist', 'Бросок медбола с полным разворотом (Медбол)'],
  ['Medicine_Ball_Scoop_Throw', 'Бросок медбола снизу вверх (Медбол)'],
  ['Rocket_Jump', 'Прыжок вверх из полуприседа (Своё тело)'],
  ['Scissors_Jump', 'Прыжки «ножницы» (Своё тело)'],
  ['Side_to_Side_Box_Shuffle', 'Боковые переступания через тумбу (Тумба)'],
  ['Single_Leg_Push-off', 'Выпрыгивание с опорой одной ногой (Тумба)'],
  ['Single-Leg_Hop_Progression', 'Серия прыжков на одной ноге (Своё тело)'],
  ['Split_Jump', 'Прыжки в выпаде (Своё тело)'],
  ['Standing_Long_Jump', 'Прыжок в длину с места (Своё тело)'],
  ['Star_Jump', 'Прыжок «звезда» (Своё тело)'],
  ['Sledgehammer_Swings', 'Удары кувалдой по покрышке (Кувалда)'],
  ['Vertical_Swing', 'Вертикальный мах гантелью (Гантель)'],

  // Мобильность и восстановление — 22.
  ['Adductor', 'Прокатка приводящих мышц (Валик)'],
  ['Anterior_Tibialis-SMR', 'Прокатка передней поверхности голени (Валик)'],
  ['Behind_Head_Chest_Stretch', 'Растяжка груди с руками за головой (Своё тело)'],
  ['Chair_Leg_Extended_Stretch', 'Растяжка задней поверхности бедра на стуле (Стул)'],
  ['Chest_And_Front_Of_Shoulder_Stretch', 'Растяжка груди и передней дельты (Своё тело)'],
  ['Foot-SMR', 'Прокатка стопы (Мяч)'],
  ['Groiners', 'Динамическая растяжка паха в выпаде (Своё тело)'],
  ['Hamstring-SMR', 'Прокатка задней поверхности бедра (Валик)'],
  ['Hip_Circles_prone', 'Круги бедром лёжа (Своё тело)'],
  ['IT_Band_and_Glute_Stretch', 'Растяжка ягодиц и наружной поверхности бедра (Своё тело)'],
  ['Inchworm', 'Выход руками в планку (Своё тело)'],
  ['Latissimus_Dorsi-SMR', 'Прокатка широчайших мышц (Валик)'],
  ['Lower_Back-SMR', 'Мягкая прокатка поясницы (Валик)'],
  ['Lying_Crossover', 'Скручивание лёжа для ягодиц (Своё тело)'],
  ['One_Handed_Hang', 'Вис на одной руке (Турник)'],
  ['Overhead_Triceps', 'Растяжка трицепса над головой (Своё тело)'],
  ['Quad_Stretch', 'Растяжка передней поверхности бедра стоя (Своё тело)'],
  ['Quadriceps-SMR', 'Прокатка передней поверхности бедра (Валик)'],
  ['Rhomboids-SMR', 'Прокатка ромбовидных мышц (Валик)'],
  ['Standing_Hamstring_and_Calf_Stretch', 'Растяжка задней поверхности бедра и икр (Своё тело)'],
  ['Stomach_Vacuum', 'Вакуум живота (Своё тело)'],
  ['Wrist_Circles', 'Круговые движения кистями (Своё тело)'],

  // Практичные силовые варианты — 29.
  ['Cable_Iron_Cross', 'Сведение рук крест-накрест в блоках (Блок)'],
  ['Donkey_Calf_Raises', 'Подъём на носки в наклоне (Своё тело)'],
  ['Dumbbell_Incline_Shoulder_Raise', 'Подъём плеч с гантелями на наклонной (Гантели)'],
  ['Dumbbell_Lying_Pronation', 'Пронация предплечья с гантелью лёжа (Гантель)'],
  ['Dumbbell_Lying_Supination', 'Супинация предплечья с гантелью лёжа (Гантель)'],
  ['Dumbbell_One-Arm_Triceps_Extension', 'Разгибание гантели одной рукой из-за головы (Гантель)'],
  ['Dumbbell_Scaption', 'Подъём гантелей в плоскости лопаток (Гантели)'],
  ['External_Rotation', 'Внешняя ротация плеча с гантелью (Гантель)'],
  ['External_Rotation_with_Cable', 'Внешняя ротация плеча в блоке (Блок)'],
  ['Front_Cable_Raise', 'Подъём руки перед собой в блоке (Блок)'],
  ['Front_Dumbbell_Raise', 'Подъём гантелей перед собой (Гантели)'],
  ['Front_Plate_Raise', 'Подъём блина перед собой (Блин)'],
  ['Internal_Rotation_with_Band', 'Внутренняя ротация плеча с резинкой (Резина)'],
  ['Kipping_Muscle_Up', 'Выход силой с махом (Турник)'],
  ['Knee_Hip_Raise_On_Parallel_Bars', 'Подъём коленей в упоре на брусьях (Своё тело)'],
  ['Kneeling_Cable_Triceps_Extension', 'Разгибание рук на трицепс с колен в блоке (Блок)'],
  ['Kettlebell_Figure_8', 'Восьмёрка с гирей между ног (Гиря)'],
  ['Lateral_Raise_-_With_Bands', 'Разведение рук в стороны с резинкой (Резина)'],
  ['Leverage_Shrug', 'Шраги в рычажном тренажёре (Тренажёр)'],
  ['Lying_Cable_Curl', 'Сгибание рук лёжа в блоке (Блок)'],
  ['Muscle_Up', 'Выход силой на перекладине (Турник)'],
  ['Overhead_Cable_Curl', 'Сгибание рук над головой в блоках (Блок)'],
  ['Plate_Pinch', 'Удержание блинов пальцами (Блины)'],
  ['Platform_Hamstring_Slides', 'Сгибание ног со скольжением пяток (Своё тело)'],
  ['Reverse_Hyperextension', 'Обратная гиперэкстензия (Тренажёр)'],
  ['Reverse_Machine_Flyes', 'Обратная разводка в тренажёре (Тренажёр)'],
  ['Ring_Dips', 'Отжимания на кольцах (Кольца)'],
  ['Single-Leg_Leg_Extension', 'Разгибание одной ноги в тренажёре (Тренажёр)'],
  ['Trap_Bar_Deadlift', 'Становая тяга с трэп-грифом (Трэп-гриф)'],
]

const DISTANCE_IDS = new Set([
  'Prowler_Sprint', 'Recumbent_Bike', 'Skating', 'Bear_Crawl_Sled_Drags',
  'Conans_Wheel', 'Forward_Drag_with_Press', 'Power_Stairs', 'Rickshaw_Carry',
  'Sled_Drag_-_Harness', 'Yoke_Walk',
])

const EQUIPMENT_LABEL = {
  barbell: 'Штанга', dumbbell: 'Гантели', machine: 'Тренажёр', cable: 'Блок',
  'body only': 'Своё тело', kettlebells: 'Гиря', bands: 'Резина', other: 'Другое',
  'medicine ball': 'Медбол', 'foam roll': 'Валик', 'e-z curl bar': 'EZ-гриф',
  'exercise ball': 'Фитбол',
}

const MUSCLE_GROUP = {
  chest: 'chest', shoulders: 'shoulders', traps: 'shoulders', neck: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  lats: 'back', 'middle back': 'back', 'lower back': 'back',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'glutes', calves: 'legs',
  adductors: 'legs', abductors: 'legs', abdominals: 'core',
}

const MUSCLE_LABEL = {
  chest: 'Грудь (середина)', shoulders: 'Плечи', traps: 'Трапеции', neck: 'Шея',
  biceps: 'Бицепс', triceps: 'Трицепс', forearms: 'Предплечья',
  lats: 'Широчайшие', 'middle back': 'Середина спины', 'lower back': 'Поясница',
  quadriceps: 'Передняя поверхность бедра', hamstrings: 'Задняя поверхность бедра',
  glutes: 'Ягодицы', calves: 'Икроножные', adductors: 'Внутренняя поверхность бедра',
  abductors: 'Наружная поверхность бедра', abdominals: 'Пресс',
}

const PRIMARY_DETAIL_OVERRIDES = {
  Dumbbell_Scaption: 'Средняя дельта', Front_Cable_Raise: 'Передняя дельта',
  Front_Dumbbell_Raise: 'Передняя дельта', Front_Plate_Raise: 'Передняя дельта',
  Reverse_Machine_Flyes: 'Задняя дельта', 'Lateral_Raise_-_With_Bands': 'Средняя дельта',
}

function refFor(id) {
  return `fedb-${id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
}

function inputKindFor(exercise) {
  if (DISTANCE_IDS.has(exercise.id) || exercise.category === 'cardio') return 'distance'
  if (exercise.category === 'stretching') return 'duration'
  if (exercise.category === 'plyometrics') return 'reps'
  if (exercise.equipment === 'body only') return 'reps'
  return 'strength'
}

function instructionsFor(name, exercise) {
  const shortName = name.replace(/\s+\([^)]+\)$/, '')
  if (exercise.category === 'stretching') return [
    `Примите исходное положение для упражнения «${shortName}» и двигайтесь только в комфортной амплитуде.`,
    'Дышите спокойно, не пружиньте и остановитесь при боли.',
  ]
  if (exercise.category === 'plyometrics') return [
    `Подготовьте устойчивую площадку для упражнения «${shortName}».`,
    'Приземляйтесь мягко, удерживайте колени по линии стоп и прекращайте подход при потере техники.',
  ]
  if (DISTANCE_IDS.has(exercise.id) || exercise.category === 'cardio') return [
    `Настройте оборудование и начните упражнение «${shortName}» в контролируемом темпе.`,
    'Сохраняйте устойчивое положение корпуса; зафиксируйте время и дистанцию.',
  ]
  return [
    `Подготовьте оборудование и примите устойчивое исходное положение для упражнения «${shortName}».`,
    'Выполняйте движение плавно и подконтрольно, без рывков и потери нейтрального положения корпуса.',
  ]
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await worker(items[index])
    }
  }))
  return results
}

async function main() {
  if (EXPANSION.length !== 120) throw new Error(`Ожидалось 120 упражнений, получено ${EXPANSION.length}`)
  if (new Set(EXPANSION.map(([id]) => id)).size !== EXPANSION.length) throw new Error('В наборе есть повторяющиеся ID')

  const all = await (await fetch(SOURCE)).json()
  const byId = new Map(all.map((exercise) => [exercise.id, exercise]))
  await mkdir(fileURLToPath(imagesDir), { recursive: true })

  const rows = await mapConcurrent(EXPANSION, 10, async ([id, name]) => {
    const exercise = byId.get(id)
    if (!exercise) throw new Error(`Не найдено упражнение ${id}`)
    if (!exercise.images?.[0] || !exercise.images?.[1]) throw new Error(`Нет двух фото у ${id}`)

    const ref = refFor(id)
    const imageName = `${ref}.jpg`
    const motionImageName = `${ref}-end.jpg`
    const [startResponse, endResponse] = await Promise.all([
      fetch(RAW_IMAGES + exercise.images[0]),
      fetch(RAW_IMAGES + exercise.images[1]),
    ])
    if (!startResponse.ok || !endResponse.ok) throw new Error(`Не удалось скачать фото ${id}`)
    await Promise.all([
      writeFile(new URL(imageName, imagesDir), Buffer.from(await startResponse.arrayBuffer())),
      writeFile(new URL(motionImageName, imagesDir), Buffer.from(await endResponse.arrayBuffer())),
    ])

    const sourceDetail = exercise.primaryMuscles[0]
    const cardio = exercise.category === 'cardio'
    return {
      source: 'system',
      ref,
      name,
      muscleGroup: cardio ? 'cardio' : (MUSCLE_GROUP[sourceDetail] ?? 'other'),
      inputKind: inputKindFor(exercise),
      equipment: EQUIPMENT_LABEL[exercise.equipment] ?? 'Другое',
      equipmentRef: exercise.equipment,
      primaryMuscleDetail: cardio ? 'Кардио' : (PRIMARY_DETAIL_OVERRIDES[id] ?? MUSCLE_LABEL[sourceDetail] ?? sourceDetail),
      secondaryMuscles: (exercise.secondaryMuscles ?? []).map((muscle) => MUSCLE_LABEL[muscle] ?? muscle),
      level: exercise.level ?? null,
      imageUrl: `/exercises/${imageName}`,
      motionImageUrl: `/exercises/${motionImageName}`,
      instructions: instructionsFor(name, exercise),
    }
  })

  const header = `// АВТОГЕНЕРАЦИЯ — не редактировать вручную.\n` +
    `// 120 отобранных упражнений из Free Exercise DB (Unlicense / public domain).\n` +
    `// Обновление: node scripts/import-exercise-expansion.mjs\n` +
    `import type { ImportedExercise } from './system-exercises'\n\n` +
    `export const CATALOG_EXPANSION: readonly ImportedExercise[] = ${JSON.stringify(rows, null, 2)}\n`
  await writeFile(fileURLToPath(generatedFile), header)
  console.log(`Готово: ${rows.length} упражнений и ${rows.length * 2} фото`)
}

main().catch((error) => { console.error(error); process.exit(1) })
