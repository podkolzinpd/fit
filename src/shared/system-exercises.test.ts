import { describe, expect, it } from 'vitest'
import { SYSTEM_EXERCISES, SYSTEM_EXERCISE_CATALOG, SYSTEM_EXERCISE_CATALOG_VERSION } from './system-exercises'
import { IMPORTED_EXERCISES } from './system-exercises.generated'
import { BASE_EXERCISES } from './system-exercises.base.generated'

const EXERCISE_MEDIA_PATHS = new Set(
  Object.keys(import.meta.glob('../../public/exercises/*.jpg', { query: '?url', import: 'default' }))
    .map((path) => path.replace('../../public', '')),
)

describe('system exercise catalog', () => {
  it('matches the V1 baseline catalog', () => {
    expect(SYSTEM_EXERCISE_CATALOG_VERSION).toBe(3)
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
    expect(SYSTEM_EXERCISE_CATALOG).toHaveLength(521)
    expect(IMPORTED_EXERCISES).toHaveLength(451)
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(SYSTEM_EXERCISES.length + IMPORTED_EXERCISES.length + 21)
    expect(new Set(SYSTEM_EXERCISE_CATALOG.map((exercise) => exercise.ref)).size).toBe(SYSTEM_EXERCISE_CATALOG.length)
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

  it('каталог = обогащённые базовые + импортированные без дублей', () => {
    expect(SYSTEM_EXERCISE_CATALOG.length).toBe(BASE_EXERCISES.length + IMPORTED_EXERCISES.length + 21)
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
