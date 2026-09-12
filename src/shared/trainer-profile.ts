import { z } from 'zod'
import type { TrainerProfileDraft, TrainerProfessionalProfile } from './domain'

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
  specialties: z.array(z.string().trim().min(1).max(60)).max(12),
  city: z.string().trim().max(100),
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
})

export function emptyTrainerProfileDraft(displayName = ''): TrainerProfileDraft {
  return {
    displayName,
    bio: '',
    specialties: [],
    city: '',
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

export function parseTrainerProfileDraft(value: unknown): TrainerProfileDraft {
  return trainerProfileDraftSchema.parse(value)
}

export function validatePublishableTrainerProfile(draft: TrainerProfileDraft): string | null {
  if (draft.displayName.trim().length < 2) return 'Укажите имя тренера.'
  return null
}
