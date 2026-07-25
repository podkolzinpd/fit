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
      name: ex.name,
      muscleGroup: muscleGroupFor(detail),
      inputKind: inputKindFor(ex.category),
      equipment: equipmentLabelFor(ex.equipment),
      equipmentRef: ex.equipment,
      primaryMuscleDetail: muscleLabelFor(detail),
      secondaryMuscles: secondary,
      level: ex.level ?? null,
      imageUrl: `/exercises/${imageName}`,
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
