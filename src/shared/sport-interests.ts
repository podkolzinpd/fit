export const SPORT_INTEREST_GROUPS = [
  { title: 'Зал и фитнес', options: [
    ['strength', 'Силовые тренировки'], ['functional', 'Функциональный тренинг'],
    ['crossfit', 'Кроссфит'], ['calisthenics', 'Калистеника'], ['yoga', 'Йога'],
    ['pilates', 'Пилатес'], ['stretching', 'Растяжка'], ['dance', 'Танцы'],
  ] },
  { title: 'Выносливость', options: [
    ['running', 'Бег'], ['trail_running', 'Трейлраннинг'], ['walking', 'Ходьба'],
    ['cycling', 'Велоспорт'], ['swimming', 'Плавание'], ['rowing', 'Гребля'], ['triathlon', 'Триатлон'],
  ] },
  { title: 'Игровые виды спорта', options: [
    ['football', 'Футбол'], ['basketball', 'Баскетбол'], ['volleyball', 'Волейбол'],
    ['tennis', 'Теннис'], ['table_tennis', 'Настольный теннис'], ['badminton', 'Бадминтон'],
  ] },
  { title: 'Единоборства', options: [
    ['boxing', 'Бокс'], ['wrestling', 'Борьба'], ['mma', 'Смешанные единоборства'],
  ] },
  { title: 'На природе и зимой', options: [
    ['hiking', 'Походы'], ['climbing', 'Скалолазание'], ['skiing', 'Лыжи'],
    ['snowboarding', 'Сноуборд'], ['skating', 'Коньки'],
  ] },
  { title: 'Другое', options: [['other', 'Другое']] },
] as const

export const SPORT_INTEREST_LABELS = Object.fromEntries(
  SPORT_INTEREST_GROUPS.flatMap((group) => group.options.map(([id, label]) => [id, label] as [string, string])),
) as Record<string, string>

export interface AthleteSportProfile {
  sports: string[]
  bio: string | null
}

export const EMPTY_ATHLETE_SPORT_PROFILE: AthleteSportProfile = { sports: [], bio: null }
