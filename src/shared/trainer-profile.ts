import { z } from 'zod'
import type { TrainerCatalogPage, TrainerProfileDraft, TrainerProfessionalProfile } from './domain'

// Фиксированный список направлений тренера — стандартизирует анкету и
// упрощает поиск клиента (вместо свободного текста). Порядок — как в анкете.
export const TRAINER_SPECIALTIES = [
  'Тренажёрный зал / силовой тренинг',
  'Функциональный тренинг',
  'Кроссфит',
  'Групповые программы (степ, аэробика и т.п.)',
  'Йога / пилатес / стретчинг',
  'Единоборства / бокс / кикбоксинг',
  'Танцевальный фитнес (зумба и т.п.)',
  'Похудение и коррекция фигуры',
  'Набор мышечной массы / бодибилдинг',
  'Реабилитация и адаптивная физкультура (после травм, ограничения по здоровью)',
  'Фитнес для беременных и после родов',
  'Детский фитнес',
  'Тренировки для пожилых (senior-фитнес)',
  'Другое',
] as const

// Ограничивает анкету узким, действительно значимым набором направлений —
// без лимита список из TRAINER_SPECIALTIES легко выбрать целиком, что для
// поиска клиента не отличается от пустого фильтра.
export const TRAINER_SPECIALTIES_MAX = 6

const certificateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  organization: z.string().trim().max(120),
  year: z.number().int().min(1950).max(new Date().getFullYear()).nullable(),
})

function removeEmptyCertificates(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((item) => {
    if (typeof item !== 'object' || item === null) return true
    const certificate = item as Record<string, unknown>
    return (typeof certificate.title === 'string' && certificate.title.trim() !== '')
      || (typeof certificate.organization === 'string' && certificate.organization.trim() !== '')
      || typeof certificate.year === 'number'
  })
}

export const trainerProfileDraftSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(1200),
  // Свободные строки на схеме (не z.enum) намеренно: уже опубликованные
  // анкеты со старым свободным текстом не должны падать на parse при чтении.
  // Новые значения в UI ограничены TRAINER_SPECIALTIES чекбоксами.
  // Максимум здесь — щедрая граница (не 6): схема читает и уже сохранённые
  // анкеты, а не только новые. Реальный лимит TRAINER_SPECIALTIES_MAX
  // держит форма (checkbox'ы блокируются) и validatePublishableTrainerProfile
  // — иначе анкета тренера, успевшего выбрать 7+ направлений до появления
  // лимита, перестанет читаться вовсе.
  specialties: z.array(z.string().trim().min(1).max(80)).max(TRAINER_SPECIALTIES.length),
  city: z.string().trim().max(100),
  metroStationIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  customLocations: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  trainingModes: z.array(z.enum(['online', 'in_person'])).max(2),
  experienceStartYear: z.number().int().min(1950).max(new Date().getFullYear()).nullable(),
  education: z.string().trim().max(800),
  formats: z.string().trim().max(800),
  price: z.string().trim().max(120),
  acceptingClients: z.boolean(),
  avatarDataUrl: z.string().max(900_000).regex(/^data:image\/(?:jpeg|png|webp);base64,/).nullable(),
  certificates: z.preprocess(removeEmptyCertificates, z.array(certificateSchema).max(10)),
})

export const trainerProfessionalProfileSchema = z.object({
  publicId: z.uuid(),
  draft: trainerProfileDraftSchema,
  published: trainerProfileDraftSchema.nullable(),
  listedInCatalog: z.boolean(),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
  version: z.number().int().positive(),
  isBrandTrainer: z.boolean(),
})

export const trainerCatalogPageSchema = z.object({
  items: z.array(trainerProfessionalProfileSchema),
  totalCount: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
})

export function emptyTrainerProfileDraft(displayName = ''): TrainerProfileDraft {
  return {
    displayName,
    bio: '',
    specialties: [],
    city: '',
    metroStationIds: [],
    customLocations: [],
    trainingModes: [],
    experienceStartYear: null,
    education: '',
    formats: '',
    price: '',
    acceptingClients: false,
    avatarDataUrl: null,
    certificates: [],
  }
}

export function parseTrainerProfile(value: unknown): TrainerProfessionalProfile {
  return trainerProfessionalProfileSchema.parse(value)
}

export function parseTrainerCatalogPage(value: unknown): TrainerCatalogPage {
  return trainerCatalogPageSchema.parse(value)
}

export function parseTrainerProfileDraft(value: unknown): TrainerProfileDraft {
  return trainerProfileDraftSchema.parse(value)
}

export function validatePublishableTrainerProfile(draft: TrainerProfileDraft): string | null {
  if (draft.displayName.trim().length < 2) return 'Укажите имя тренера.'
  // Форма не даёт выбрать больше TRAINER_SPECIALTIES_MAX, но анкета, где
  // направления выбирались до появления лимита, могла сохранить больше —
  // ловим это здесь, а не тихо публикуем как есть.
  if (draft.specialties.length > TRAINER_SPECIALTIES_MAX) return `Оставьте не больше ${TRAINER_SPECIALTIES_MAX} направлений.`
  return null
}
