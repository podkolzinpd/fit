import { describe, expect, it } from 'vitest'
import { SYSTEM_EXERCISES, SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISE_CATALOG_VERSION } from './system-exercises'
import { IMPORTED_EXERCISES } from './system-exercises.generated'
import { BASE_EXERCISES } from './system-exercises.base.generated'
import { CATALOG_EXPANSION } from './system-exercises.expansion.generated'
import { VITAL_FREE_PACK_ASSETS, VITAL_FREE_PACK_EXERCISES } from './vital-free-pack'

const EXERCISE_MEDIA_PATHS = new Set(
  Object.keys(import.meta.glob('../../public/exercises/**/*.jpg', { query: '?url', import: 'default' }))
    .map((path) => path.replace('../../public', '')),
)
const EXERCISE_VIDEO_PATHS = new Set(
  Object.keys(import.meta.glob('../../public/exercises/vital/*.mp4', { query: '?url', import: 'default' }))
    .map((path) => path.replace('../../public', '')),
)

describe('system exercise catalog', () => {
  it('matches the V1 baseline catalog', () => {
    expect(SYSTEM_EXERCISE_CATALOG_VERSION).toBe(6)
    expect(SYSTEM_EXERCISES).toHaveLength(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.ref)).size).toBe(49)
    expect(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.name)).size).toBe(49)
  })

  it('preserves the V1 category distribution', () => {
    const count = (group: string) => SYSTEM_EXERCISES.filter((exercise) => exercise.muscleGroup === group).length
    expect({
      legs: count('legs'), chest: count('chest'), back: count('back'),
      shoulders: count('shoulders'), arms: count('arms'), core: count('core'), cardio: count('cardio'),
      // Гиперэкстензия перенесена legs→back (разгибание спины, п.3a-ревизия).
    }).toEqual({ legs: 10, chest: 7, back: 8, shoulders: 6, arms: 6, core: 5, cardio: 7 })
  })

  it('keeps the cardio input semantics', () => {
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'distance')).toHaveLength(5)
    // Упражнения с собственным весом считаются по повторам, без фиктивных 0 кг.
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'reps').map((exercise) => exercise.name))
      .toEqual(['Отжимания', 'Отжимания на брусьях', 'Подтягивания', 'Отжимания узким хватом', 'Скручивания', 'Подъём ног', 'Русский твист', 'Прыжки со скакалкой', 'Берпи'])
    expect(SYSTEM_EXERCISES.filter((exercise) => exercise.inputKind === 'duration').map((exercise) => exercise.name))
      .toEqual(['Планка', 'Боковая планка'])
  })

  it('добавляет кардио- и функциональные протоколы с корректным форматом факта', () => {
    const protocol = (ref: string) => SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === ref)
    for (const ref of ['interval-bike', 'interval-rowing', 'interval-walking', 'farmer-carry', 'sled-push']) {
      expect(protocol(ref)).toMatchObject({ muscleGroup: 'cardio', inputKind: 'distance' })
    }
    for (const ref of ['tabata', 'emom', 'amrap', 'circuit-training']) {
      expect(protocol(ref)).toMatchObject({ muscleGroup: 'cardio', inputKind: 'reps' })
    }
  })

  it('использует один ref для вариантов бега и добавляет отдельные СБУ', () => {
    expect(SYSTEM_EXERCISE_CATALOG.some((exercise) => exercise.ref === 'interval-running')).toBe(false)
    for (const ref of ['running-high-knees', 'running-butt-kicks', 'running-ankling', 'running-bounds']) {
      expect(SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === ref))
        .toMatchObject({ muscleGroup: 'cardio', inputKind: 'distance', primaryMuscleDetail: 'Беговые упражнения' })
    }
  })

  it('добавляет отдельный набор разминки и мобилити с вводом времени', () => {
    const refs = ['joint-warmup', 'shoulder-mobility', 'band-external-rotation', 'thoracic-mobility', 'hip-mobility', 'ankle-mobility', 'dynamic-hamstring-stretch', 'cat-cow']
    for (const ref of refs) expect(SYSTEM_EXERCISE_CATALOG.find((exercise) => exercise.ref === ref)).toMatchObject({ ref, inputKind: 'duration' })
  })

  it('добавляет импортированный каталог поверх базового без дублей', () => {
    // Полный каталог = 49 базовых + импортированные, ref уникальны.
    expect(SYSTEM_EXERCISE_CATALOG).toHaveLength(662)
    expect(IMPORTED_EXERCISES).toHaveLength(451)
    expect(CATALOG_EXPANSION).toHaveLength(120)
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(SYSTEM_EXERCISES.length + IMPORTED_EXERCISES.length + CATALOG_EXPANSION.length + 42)
    expect(new Set(SYSTEM_EXERCISE_CATALOG.map((exercise) => exercise.ref)).size).toBe(SYSTEM_EXERCISE_CATALOG.length)
  })

  it('добавляет 120 отобранных упражнений с двумя фото и русскими данными', () => {
    expect(new Set(CATALOG_EXPANSION.map((exercise) => exercise.ref)).size).toBe(CATALOG_EXPANSION.length)
    expect(new Set(CATALOG_EXPANSION.map((exercise) => exercise.name)).size).toBe(CATALOG_EXPANSION.length)
    for (const exercise of CATALOG_EXPANSION) {
      expect(exercise.ref).toMatch(/^fedb-/)
      expect(exercise.name.replace(/EZ/g, '')).not.toMatch(/[A-Za-z]/)
      expect(exercise.name).toMatch(/\([^)]+\)$/)
      expect(exercise.equipment).toBeTruthy()
      expect(exercise.primaryMuscleDetail).toBeTruthy()
      expect(exercise.instructions?.length).toBeGreaterThanOrEqual(2)
      expect(EXERCISE_MEDIA_PATHS.has(exercise.imageUrl)).toBe(true)
      expect(EXERCISE_MEDIA_PATHS.has(exercise.motionImageUrl)).toBe(true)
    }
  })

  it('использует подходящий формат результата в новых направлениях', () => {
    const exercise = (ref: string) => CATALOG_EXPANSION.find((item) => item.ref === ref)
    expect(exercise('fedb-recumbent-bike')).toMatchObject({ muscleGroup: 'cardio', inputKind: 'distance' })
    expect(exercise('fedb-yoke-walk')).toMatchObject({ inputKind: 'distance' })
    expect(exercise('fedb-front-box-jump')).toMatchObject({ inputKind: 'reps' })
    expect(exercise('fedb-hamstring-smr')).toMatchObject({ inputKind: 'duration' })
    expect(exercise('fedb-trap-bar-deadlift')).toMatchObject({ inputKind: 'strength' })
  })

  it('импортированные упражнения имеют метаданные каталога', () => {
    expect(IMPORTED_EXERCISES.length).toBeGreaterThanOrEqual(100)
    for (const exercise of IMPORTED_EXERCISES) {
      expect(exercise.source).toBe('system')
      expect(exercise.ref).toMatch(/^fedb-/)
      expect(exercise.equipment).toBeTruthy()
      expect(exercise.primaryMuscleDetail).toBeTruthy()
      expect(exercise.imageUrl).toMatch(/^\/exercises\/fedb-.+\.jpg$/)
    }
  })

  it('считает импортированные упражнения с собственным весом по повторам', () => {
    const bodyweightExercises = SYSTEM_EXERCISE_CATALOG.filter((exercise) => exercise.equipmentRef === 'body only')
    expect(bodyweightExercises.length).toBeGreaterThan(0)
    expect(bodyweightExercises.every((exercise) => exercise.inputKind !== 'strength')).toBe(true)
  })

  it('импортированные названия переведены на русский в формате «Упражнение (Оборудование)»', () => {
    for (const exercise of IMPORTED_EXERCISES) {
      // Нет латиницы, кроме принятого термина «EZ» (EZ-гриф); есть «(Оборудование)».
      expect(exercise.name.replace(/EZ/g, '')).not.toMatch(/[A-Za-z]/)
      expect(exercise.name).toMatch(/\([^)]+\)$/)
    }
    // Названия уникальны.
    expect(new Set(IMPORTED_EXERCISES.map((exercise) => exercise.name)).size).toBe(IMPORTED_EXERCISES.length)
  })

  it('деталь мышцы соответствует своей группе (нет «Бицепс бедра» в «Спине» и т.п.)', () => {
    // Какие детали допустимы в каждой укрупнённой группе. Ловит регресс, когда
    // упражнение попадает в группу с чужой подкатегорией мышцы.
    // Народные термины + детализация пучков дельт / верх-низ груди (п.3b).
    const allowed: Record<string, string[]> = {
      legs: ['Передняя поверхность бедра', 'Задняя поверхность бедра', 'Икроножные', 'Внутренняя поверхность бедра', 'Наружная поверхность бедра'],
      glutes: ['Ягодицы'],
      back: ['Середина спины', 'Широчайшие', 'Поясница'],
      chest: ['Грудь (верх)', 'Грудь (середина)', 'Грудь (низ)'],
      shoulders: ['Плечи', 'Передняя дельта', 'Средняя дельта', 'Задняя дельта', 'Трапеции'],
      arms: ['Бицепс', 'Трицепс', 'Предплечья'],
      core: ['Пресс'],
      cardio: ['Кардио'],
    }
    for (const exercise of IMPORTED_EXERCISES) {
      expect(allowed[exercise.muscleGroup], `группа ${exercise.muscleGroup} (${exercise.name})`).toBeDefined()
      expect(allowed[exercise.muscleGroup], `${exercise.name}: деталь «${exercise.primaryMuscleDetail}» не из группы «${exercise.muscleGroup}»`)
        .toContain(exercise.primaryMuscleDetail)
    }
  })

  it('плечи разбиты на пучки дельт, грудь — на верх/середину/низ (п.3b)', () => {
    const details = new Set(IMPORTED_EXERCISES.map((exercise) => exercise.primaryMuscleDetail))
    for (const head of ['Передняя дельта', 'Средняя дельта', 'Задняя дельта']) expect(details).toContain(head)
    for (const zone of ['Грудь (верх)', 'Грудь (середина)', 'Грудь (низ)']) expect(details).toContain(zone)
    // Народные термины ног применены.
    for (const term of ['Передняя поверхность бедра', 'Задняя поверхность бедра', 'Икроножные']) expect(details).toContain(term)
  })

  it('базовые упражнения обогащены до идеального формата', () => {
    // Обогащённых базовых столько же, сколько рукописных, ref совпадают.
    expect(BASE_EXERCISES.length).toBe(SYSTEM_EXERCISES.length)
    expect(new Set(BASE_EXERCISES.map((exercise) => exercise.ref)))
      .toEqual(new Set(SYSTEM_EXERCISES.map((exercise) => exercise.ref)))
    for (const exercise of BASE_EXERCISES) {
      expect(exercise.name).toMatch(/\([^)]+\)$/)  // «Название (Оборудование)»
      expect(exercise.equipment).toBeTruthy()
      expect(exercise.primaryMuscleDetail).toBeTruthy()
    }
    // Все базовые получили оба кадра (кардио/берпи — из близкого аналога).
    expect(BASE_EXERCISES.every((exercise) => exercise.imageUrl)).toBe(true)
    expect(BASE_EXERCISES.every((exercise) => exercise.motionImageUrl)).toBe(true)
  })

  it('весь каталог имеет обложку и второй кадр техники', () => {
    expect(SYSTEM_EXERCISE_CATALOG.every((exercise) => exercise.imageUrl)).toBe(true)
    expect(SYSTEM_EXERCISE_CATALOG.every((exercise) => exercise.motionImageUrl)).toBe(true)
    for (const exercise of SYSTEM_EXERCISE_CATALOG) {
      for (const url of [exercise.imageUrl, exercise.motionImageUrl]) {
        expect(EXERCISE_MEDIA_PATHS.has(url!), `${exercise.name}: отсутствует ${url}`).toBe(true)
      }
    }
  })

  it('подключает все 50 видео бесплатного пака только к точным упражнениям', () => {
    const expected = new Map<string, string>(VITAL_FREE_PACK_ASSETS.map((asset) => [asset.ref, `/exercises/vital/${asset.file}.mp4`]))
    expect(VITAL_FREE_PACK_ASSETS).toHaveLength(50)
    expect(new Set(VITAL_FREE_PACK_ASSETS.map((asset) => asset.id))).toEqual(new Set(Array.from({ length: 50 }, (_, index) => String(index + 51).padStart(4, '0'))))
    expect(new Set(VITAL_FREE_PACK_ASSETS.map((asset) => asset.ref)).size).toBe(50)
    expect(new Set(VITAL_FREE_PACK_ASSETS.map((asset) => asset.file)).size).toBe(50)
    const withVideo = SYSTEM_EXERCISE_CATALOG.filter((exercise) => exercise.techniqueVideoUrl)
    expect(withVideo).toHaveLength(expected.size)
    for (const exercise of withVideo) {
      expect(exercise.techniqueVideoUrl).toBe(expected.get(exercise.ref))
      expect(EXERCISE_VIDEO_PATHS.has(exercise.techniqueVideoUrl!)).toBe(true)
    }
  })

  it('добавляет отдельные карточки только для отсутствующих движений Free50', () => {
    expect(VITAL_FREE_PACK_EXERCISES).toHaveLength(21)
    for (const exercise of VITAL_FREE_PACK_EXERCISES) {
      expect(exercise.name).toMatch(/\([^)]+\)$/)
      expect(exercise.instructions?.length).toBeGreaterThanOrEqual(3)
      expect(EXERCISE_MEDIA_PATHS.has(exercise.imageUrl!)).toBe(true)
      expect(EXERCISE_MEDIA_PATHS.has(exercise.motionImageUrl!)).toBe(true)
    }
  })

  it('каталог = обогащённые базовые + импортированные без дублей', () => {
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(BASE_EXERCISES.length + IMPORTED_EXERCISES.length + CATALOG_EXPANSION.length + 42)
    expect(new Set(SYSTEM_EXERCISE_CATALOG.map((exercise) => exercise.ref)).size).toBe(SYSTEM_EXERCISE_CATALOG.length)
  })

  it('весь каталог имеет русские инструкции (0 англ., 0 пустых)', () => {
    for (const exercise of SYSTEM_EXERCISE_CATALOG) {
      expect(exercise.instructions?.length).toBeGreaterThan(0)
      // Нет длинных латинских слов (остатков английского) в шагах техники.
      for (const step of exercise.instructions ?? []) expect(step).not.toMatch(/[A-Za-z]{4,}/)
    }
  })
})
