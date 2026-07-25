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

const SOURCE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json'
const RAW_IMAGES = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
const TARGET_COUNT = 120

const projectRoot = new URL('..', import.meta.url)
const imagesDir = new URL('public/exercises/', projectRoot)
const generatedFile = new URL('src/shared/system-exercises.generated.ts', projectRoot)

// Детальная мышца Free Exercise DB -> наш укрупнённый MuscleGroup.
const MUSCLE_GROUP = {
  chest: 'chest',
  shoulders: 'shoulders', traps: 'shoulders', neck: 'shoulders',
  biceps: 'arms', triceps: 'arms', forearms: 'arms',
  lats: 'back', 'middle back': 'back', 'lower back': 'back',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
  abdominals: 'core',
}
// Детальная мышца -> русский лейбл для карточки.
const MUSCLE_LABEL = {
  chest: 'Грудь', shoulders: 'Плечи', traps: 'Трапеции', neck: 'Шея',
  biceps: 'Бицепс', triceps: 'Трицепс', forearms: 'Предплечья',
  lats: 'Широчайшие', 'middle back': 'Середина спины', 'lower back': 'Поясница',
  quadriceps: 'Квадрицепс', hamstrings: 'Бицепс бедра', glutes: 'Ягодицы',
  calves: 'Икры', adductors: 'Приводящие', abductors: 'Отводящие', abdominals: 'Пресс',
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
    rows.push({
      source: 'system',
      ref,
      name,
      muscleGroup: muscleGroupFor(detail),
      inputKind: inputKindFor(ex.category),
      equipment: equipmentLabelFor(ex.equipment),
      equipmentRef: ex.equipment,
      primaryMuscleDetail: muscleLabelFor(detail),
      secondaryMuscles: secondary,
      level: ex.level ?? null,
      imageUrl: `/exercises/${imageName}`,
      instructions: ex.instructions ?? [],
    })
  }

  const header = `// АВТОГЕНЕРАЦИЯ — не редактировать вручную.\n` +
    `// Источник: Free Exercise DB (yuhonas), лицензия Unlicense / public domain.\n` +
    `// Обновление: node scripts/import-exercises.mjs\n` +
    `import type { ImportedExercise } from './system-exercises'\n\n` +
    `export const IMPORTED_EXERCISES: readonly ImportedExercise[] = ${JSON.stringify(rows, null, 2)}\n`
  await writeFile(fileURLToPath(generatedFile), header)
  console.log(`Готово: ${rows.length} упражнений, картинки в public/exercises/, данные в system-exercises.generated.ts`)
}

main().catch((error) => { console.error(error); process.exit(1) })
