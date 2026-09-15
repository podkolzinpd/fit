import { PROGRAM_EQUIPMENT, PROGRAM_CATALOG, type Equipment } from './catalog.js'
import type { ProgramFrequency } from './context.js'

export interface ProgramBrief {
  goalText?: string
  goal?: 'strength' | 'hypertrophy' | 'general_fitness' | 'weight_loss'
  frequency?: ProgramFrequency
  weekdays?: number[]
  durationMin?: number
  startDate?: string
  experience?: 'beginner' | 'returning' | 'experienced'
  equipment?: Equipment[]
  limitations?: 'none' | 'present' | 'unknown'
  limitationsText?: string
  preferences?: string
  excludedRefs?: string[]
  otherActivity?: string
  adult?: boolean
}

const briefProperties = {
  goalText: { type: 'string', maxLength: 500 },
  goal: { type: 'string', enum: ['strength', 'hypertrophy', 'general_fitness', 'weight_loss'] },
  frequency: { type: 'integer', minimum: 1, maximum: 3 },
  weekdays: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 7 } },
  durationMin: { type: 'integer', minimum: 20, maximum: 120 },
  startDate: { type: 'string' },
  experience: { type: 'string', enum: ['beginner', 'returning', 'experienced'] },
  equipment: { type: 'array', items: { type: 'string', enum: PROGRAM_EQUIPMENT } },
  limitations: { type: 'string', enum: ['none', 'present', 'unknown'] },
  limitationsText: { type: 'string', maxLength: 500 },
  preferences: { type: 'string', maxLength: 800 },
  excludedRefs: { type: 'array', items: { type: 'string', enum: PROGRAM_CATALOG.map((row) => row.ref) } },
  otherActivity: { type: 'string', maxLength: 500 },
  adult: { type: 'boolean' },
} as const

export const briefKeys = Object.keys(briefProperties) as (keyof ProgramBrief)[]
export const briefExtractionSchema = {
  type: 'object', additionalProperties: false, required: ['patch', 'clear', 'evidence', 'clarification'],
  properties: {
    patch: { type: 'object', additionalProperties: false, properties: briefProperties },
    clear: { type: 'array', items: { type: 'string', enum: briefKeys } },
    evidence: { type: 'object', additionalProperties: false, properties: Object.fromEntries(briefKeys.map((key) => [key, { type: 'string' }])) },
    clarification: { type: ['string', 'null'] },
  },
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function readProgramBrief(value: unknown): ProgramBrief | undefined {
  if (!object(value) || Object.keys(value).some((key) => !briefKeys.includes(key as keyof ProgramBrief))) return undefined
  for (const [key, item] of Object.entries(value)) {
    if (key === 'adult') { if (typeof item !== 'boolean') return undefined }
    else if (key === 'frequency') { if (item !== 1 && item !== 2 && item !== 3) return undefined }
    else if (key === 'durationMin') { if (typeof item !== 'number' || !Number.isInteger(item) || item < 20 || item > 120) return undefined }
    else if (key === 'weekdays') {
      if (!Array.isArray(item) || item.length < 1 || item.length > 3 || new Set(item).size !== item.length
        || !item.every((day) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7)) return undefined
    } else if (key === 'equipment' || key === 'excludedRefs') {
      const allowed: readonly string[] = key === 'equipment' ? PROGRAM_EQUIPMENT : PROGRAM_CATALOG.map((row) => row.ref)
      if (!Array.isArray(item) || item.length > allowed.length || new Set(item).size !== item.length
        || !item.every((entry) => typeof entry === 'string' && allowed.includes(entry))) return undefined
    } else if (key === 'startDate') { if (!isCalendarDate(item)) return undefined }
    else if (key === 'goal') { if (!['strength', 'hypertrophy', 'general_fitness', 'weight_loss'].includes(String(item))) return undefined }
    else if (key === 'experience') { if (!['beginner', 'returning', 'experienced'].includes(String(item))) return undefined }
    else if (key === 'limitations') { if (!['none', 'present', 'unknown'].includes(String(item))) return undefined }
    else if (typeof item !== 'string' || item.trim().length === 0 || item.length > (key === 'preferences' ? 800 : 500)) return undefined
  }
  return value
}

function normalize(text: string): string { return text.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim() }

export function mergeExtractedBrief(previous: ProgramBrief, message: string, value: unknown): { brief: ProgramBrief; clarification: string | null } {
  if (!object(value) || Object.keys(value).some((key) => !['patch', 'clear', 'evidence', 'clarification'].includes(key))) throw new Error('invalid_brief_extraction')
  const patch = readProgramBrief(value.patch)
  const { clear, evidence, clarification } = value
  if (!patch || !Array.isArray(clear) || clear.some((key) => !briefKeys.includes(key as keyof ProgramBrief)) || !object(evidence)
    || (clarification !== null && (typeof clarification !== 'string' || clarification.length > 700))) throw new Error('invalid_brief_extraction')
  // A model cannot fill fields from assumptions or carry another client's answers.
  const clearedKeys = clear as (keyof ProgramBrief)[]
  for (const key of [...Object.keys(patch), ...clearedKeys]) {
    const quote = evidence[key]
    if (typeof quote !== 'string' || !normalize(quote) || !normalize(message).includes(normalize(quote))) throw new Error('brief_evidence_missing')
  }
  const next: Record<string, unknown> = { ...previous }
  for (const key of clearedKeys) delete next[key]
  Object.assign(next, patch)
  // Frequency changes cannot silently reuse an incompatible old schedule.
  if (patch.frequency !== undefined && patch.weekdays === undefined && previous.frequency !== patch.frequency) delete next.weekdays
  if (patch.goalText !== undefined && patch.goal === undefined) delete next.goal
  const brief = readProgramBrief(next)
  if (!brief) throw new Error('invalid_brief_extraction')
  return { brief, clarification }
}

export const briefQuestions: Partial<Record<keyof ProgramBrief, string>> = {
  goalText: 'Какова цель именно этой четырёхнедельной программы: что хотите улучшить?',
  goal: 'Основной приоритет — сила, набор мышц, общая форма или снижение веса?',
  frequency: 'Сколько занятий в неделю планируем: одно, два или три?',
  weekdays: 'В какие дни недели удобно тренироваться?',
  durationMin: 'Сколько минут есть на одно занятие, включая разминку и отдых?',
  startDate: 'С какой даты начинается четырёхнедельная программа?',
  experience: 'Какой опыт тренировок и был ли в последнее время перерыв?',
  equipment: 'Какое оборудование доступно? Можно перечислить его или указать полностью оборудованный тренажёрный зал.',
  limitations: 'Есть ли сейчас боль, травмы или ограничения для упражнений? Если нет — так и напишите.',
  preferences: 'Есть ли любимые или нежелательные упражнения? Можно ответить «предпочтений нет».',
  otherActivity: 'Есть ли другая регулярная нагрузка — бег, спорт или физическая работа?',
  adult: 'Клиенту уже исполнилось 18 лет?',
}

export function missingBriefFields(brief: ProgramBrief): (keyof ProgramBrief)[] {
  const missing = Object.keys(briefQuestions).filter((key) => brief[key as keyof ProgramBrief] === undefined) as (keyof ProgramBrief)[]
  if (brief.weekdays && brief.frequency && brief.weekdays.length !== brief.frequency && !missing.includes('weekdays')) missing.push('weekdays')
  return missing
}

export function briefSummary(brief: ProgramBrief): string {
  const days = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const experience = { beginner: 'начальный', returning: 'возвращение после перерыва', experienced: 'есть опыт' }
  const equipmentNames: Record<Equipment, string> = { dumbbells: 'гантели', barbell: 'штанга', bench: 'скамья', rack: 'стойка', cable: 'блочный тренажёр', pullup_bar: 'турник', leg_press: 'жим ногами', leg_curl: 'сгибание ног', leg_extension: 'разгибание ног' }
  return [brief.goalText && `Цель: ${brief.goalText}`, brief.frequency && `${brief.frequency} занятий в неделю · 4 недели`,
    brief.weekdays && `Дни: ${brief.weekdays.map((day) => days[day - 1]).join(', ')}`,
    brief.durationMin && `До ${brief.durationMin} минут`, brief.startDate && `Начало: ${brief.startDate}`,
    brief.equipment && `Оборудование: ${brief.equipment.length ? brief.equipment.map((item) => equipmentNames[item]).join(', ') : 'без оборудования'}`,
    brief.adult !== undefined && `Совершеннолетний: ${brief.adult ? 'да' : 'нет'}`,
    brief.excludedRefs?.length && `Исключены: ${brief.excludedRefs.map((ref) => PROGRAM_CATALOG.find((row) => row.ref === ref)?.name).join(', ')}`,
    brief.experience && `Опыт: ${experience[brief.experience]}`,
    brief.limitations && `Ограничения: ${brief.limitations === 'none' ? 'не заявлены' : brief.limitationsText ?? 'нужно уточнить'}`,
    brief.preferences && `Пожелания: ${brief.preferences}`, brief.otherActivity && `Другая нагрузка: ${brief.otherActivity}`,
  ].filter(Boolean).join('\n')
}

export const CONFIRM_PROGRAM_BRIEF = 'Подтверждаю анкету, составь программу'
