import { PROGRAM_EQUIPMENT, PROGRAM_CATALOG, type Equipment } from './catalog.js'
import type { ProgramFrequency } from './context.js'

export interface ProgramBrief {
  continuationPlan?: string
  preserveRefs?: string[]
  goalText?: string
  goal?: 'strength' | 'hypertrophy' | 'general_fitness' | 'weight_loss'
  frequency?: ProgramFrequency
  weekdays?: number[]
  durationMin?: number
  startDate?: string
  experience?: 'beginner' | 'returning' | 'experienced'
  experienceText?: string
  equipment?: Equipment[]
  limitations?: 'none' | 'present' | 'unknown'
  limitationsText?: string
  limitationAdjustments?: string
  preferences?: string
  excludedRefs?: string[]
  otherActivity?: string
  otherActivities?: { kind: string; frequency: number; weekdays: number[] }[]
  activityOverlapConfirmed?: boolean
  historyComplete?: boolean
  adult?: boolean
}

export const briefProperties = {
  continuationPlan: { type: 'string', maxLength: 500 },
  preserveRefs: { type: 'array', items: { type: 'string', enum: PROGRAM_CATALOG.map((row) => row.ref) } },
  goalText: { type: 'string', maxLength: 500 },
  goal: { type: 'string', enum: ['strength', 'hypertrophy', 'general_fitness', 'weight_loss'] },
  frequency: { type: 'integer', minimum: 1, maximum: 3 },
  weekdays: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 7 } },
  durationMin: { type: 'integer', minimum: 30, maximum: 120 },
  startDate: { type: 'string' },
  experienceText: { type: 'string', maxLength: 500 },
  experience: { type: 'string', enum: ['beginner', 'returning', 'experienced'] },
  equipment: { type: 'array', items: { type: 'string', enum: PROGRAM_EQUIPMENT } },
  limitations: { type: 'string', enum: ['none', 'present', 'unknown'] },
  limitationsText: { type: 'string', maxLength: 500 },
  limitationAdjustments: { type: 'string', maxLength: 500 },
  preferences: { type: 'string', maxLength: 800 },
  excludedRefs: { type: 'array', items: { type: 'string', enum: PROGRAM_CATALOG.map((row) => row.ref) } },
  otherActivity: { type: 'string', maxLength: 500 },
  otherActivities: { type: 'array', maxItems: 5, items: { type: 'object', additionalProperties: false,
    required: ['kind', 'frequency', 'weekdays'], properties: {
      kind: { type: 'string', maxLength: 100 }, frequency: { type: 'integer', minimum: 1, maximum: 7 },
      weekdays: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 1, maximum: 7 } },
    } } },
  activityOverlapConfirmed: { type: 'boolean' },
  historyComplete: { type: 'boolean' },
  adult: { type: 'boolean' },
} as const

export const briefKeys = Object.keys(briefProperties) as (keyof ProgramBrief)[]
export const briefExtractionSchema = {
  type: 'object', additionalProperties: false, required: ['changes', 'clarification'],
  properties: {
    changes: { type: 'array', maxItems: briefKeys.length, items: {
      type: 'object', additionalProperties: false, required: ['field', 'operation', 'value', 'quote'], properties: {
        field: { type: 'string', enum: briefKeys }, operation: { type: 'string', enum: ['set', 'clear'] },
        value: { type: 'string' }, quote: { type: 'string' },
      },
    } },
    clarification: { type: ['string', 'null'] },
  },
}

export function decodeQuotedBriefPatch(value: unknown): unknown {
  if (!object(value) || !Array.isArray(value.changes) || value.changes.length > briefKeys.length) throw new Error('invalid_brief_extraction')
  const patch: Record<string, unknown> = {}
  const evidence: Record<string, unknown> = {}
  const clear: string[] = []
  for (const change of value.changes) {
    if (!object(change) || typeof change.field !== 'string' || !briefKeys.includes(change.field as keyof ProgramBrief)
      || typeof change.value !== 'string' || typeof change.quote !== 'string' || Object.hasOwn(evidence, change.field)) throw new Error('invalid_brief_extraction')
    const { field, quote } = change
    const text = change.value.trim()
    evidence[field] = quote
    if (change.operation === 'clear') { clear.push(field); continue }
    if (change.operation !== 'set') throw new Error('invalid_brief_extraction')
    patch[field] = field === 'frequency' || field === 'durationMin' ? Number(text)
      : field === 'adult' || field === 'historyComplete' || field === 'activityOverlapConfirmed' ? text === 'true' ? true : text === 'false' ? false : undefined
        : field === 'otherActivities' ? JSON.parse(text) as unknown
        : field === 'weekdays' ? text.split(',').map((day) => Number(day.trim()))
          : field === 'equipment' || field === 'excludedRefs' || field === 'preserveRefs' ? text ? text.split(',').map((entry) => entry.trim()) : [] : text
  }
  return { patch, clear, evidence, clarification: value.clarification }
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
    if (key === 'adult' || key === 'activityOverlapConfirmed' || key === 'historyComplete') { if (typeof item !== 'boolean') return undefined }
    else if (key === 'otherActivities') {
      if (!Array.isArray(item) || item.length > 5 || !item.every((activity: unknown) => object(activity)
        && Object.keys(activity).length === 3 && typeof activity.kind === 'string' && activity.kind.trim().length > 0 && activity.kind.length <= 100
        && typeof activity.frequency === 'number' && Number.isInteger(activity.frequency) && activity.frequency >= 1 && activity.frequency <= 7
        && Array.isArray(activity.weekdays) && activity.weekdays.length === activity.frequency && new Set(activity.weekdays).size === activity.frequency
        && activity.weekdays.every((day: unknown) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7))) return undefined
    }
    else if (key === 'frequency') { if (item !== 1 && item !== 2 && item !== 3) return undefined }
    else if (key === 'durationMin') { if (typeof item !== 'number' || !Number.isInteger(item) || item < 30 || item > 120) return undefined }
    else if (key === 'weekdays') {
      if (!Array.isArray(item) || item.length < 1 || item.length > 3 || new Set(item).size !== item.length
        || !item.every((day) => typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 7)) return undefined
    } else if (key === 'equipment' || key === 'excludedRefs' || key === 'preserveRefs') {
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

/** Narrow deterministic guard; ambiguous language must be clarified, not guessed. */
function explicitFrequency(text: string): number | undefined {
  const numbers: Record<string, number> = { один: 1, одно: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7 }
  const token = '(?:[0-9]+|один|одно|одну|два|две|три|четыре|пять|шесть|семь)'
  let normalized = normalize(text)
  // A clear correction keeps the new value, including an omitted unit on the old value.
  normalized = normalized.replace(new RegExp(`не\\s+${token}(?:\\s+(?:раза?|занятия?|тренировки?))?\\s*,?\\s*а\\s+(${token})`, 'gu'), '$1')
  if (new RegExp(`(?:не\\s+${token}|${token}\\s*(?:или|[-–—])\\s*${token})`, 'u').test(normalized)) return undefined
  const matches = [...normalized.matchAll(new RegExp(`(?<![\\p{L}0-9])(${token})\\s*(?:раз(?:а)?|заняти[еяй]|трениров(?:ка|ки|ок))(?!\\p{L})`, 'gu'))]
  const values = matches.map((match) => numbers[match[1]!] ?? Number(match[1]))
  if (!values.length && new RegExp(`^${token}[.!]?$`, 'u').test(normalized)) values.push(numbers[normalized.replace(/[.!]$/, '')] ?? Number(normalized.replace(/[.!]$/, '')))
  return new Set(values).size === 1 ? values[0] : undefined
}

export const CONFIRM_ACTIVITY_OVERLAP = 'Совмещение нагрузок в эти дни согласовано'
export const HISTORY_COMPLETE = 'Это все тренировки'
export const HISTORY_INCOMPLETE = 'Часть тренировок не записана'
export function noOtherActivity(brief: ProgramBrief): boolean {
  return /^(?:нет|нет другой (?:нагрузки|активности)|другой (?:нагрузки|активности) нет|отсутствует)[.!]?$/u.test(normalize(brief.otherActivity ?? ''))
}

export function activityNeedsDetails(brief: ProgramBrief): boolean {
  return brief.otherActivity !== undefined && !noOtherActivity(brief) && !brief.otherActivities?.length
}
export function activityOverlap(brief: ProgramBrief): boolean {
  return !noOtherActivity(brief) && !!brief.otherActivities?.some((activity) => activity.weekdays.some((day) => brief.weekdays?.includes(day)))
}

export function mergeExtractedBrief(previous: ProgramBrief, message: string, value: unknown): { brief: ProgramBrief; clarification: string | null } {
  if (!object(value) || Object.keys(value).some((key) => !['patch', 'clear', 'evidence', 'clarification'].includes(key))) throw new Error('invalid_brief_extraction')
  const patch = readProgramBrief(value.patch)
  const { clear, evidence, clarification } = value
  if (!patch || !Array.isArray(clear) || clear.some((key) => !briefKeys.includes(key as keyof ProgramBrief)) || !object(evidence)
    || (clarification !== null && (typeof clarification !== 'string' || clarification.length > 700))) throw new Error('invalid_brief_extraction')
  // A model cannot fill fields from assumptions or carry another client's answers.
  const clearedKeys = clear as (keyof ProgramBrief)[]
  for (const key of [...Object.keys(patch), ...clearedKeys]) {
    // Models may echo already confirmed values. They do not introduce a change
    // and must not force the user to repeat the original evidence.
    const field = key as keyof ProgramBrief
    if (!clearedKeys.includes(field) && Object.hasOwn(previous, key) && JSON.stringify(patch[field]) === JSON.stringify(previous[field])) continue
    const quote = evidence[key]
    if (typeof quote !== 'string' || !normalize(quote) || !normalize(message).includes(normalize(quote))) throw new Error('brief_evidence_missing')
  }
  if (patch.experienceText && !normalize(message).includes(normalize(patch.experienceText))) throw new Error('brief_evidence_missing')
  if (patch.frequency !== undefined && patch.frequency !== previous.frequency && explicitFrequency(message) !== patch.frequency) throw new Error('brief_frequency_ambiguous')
  if (patch.activityOverlapConfirmed === true && normalize(message) !== normalize(CONFIRM_ACTIVITY_OVERLAP)) throw new Error('brief_activity_confirmation_missing')
  const next: Record<string, unknown> = { ...previous }
  for (const key of clearedKeys) delete next[key]
  Object.assign(next, patch)
  if ((clearedKeys.includes('experience') || patch.experience !== undefined && patch.experience !== previous.experience) && patch.experienceText === undefined) delete next.experienceText
  if (((patch.limitationsText !== undefined && patch.limitationsText !== previous.limitationsText)
    || (patch.limitations !== undefined && patch.limitations !== previous.limitations)
    || clearedKeys.includes('limitationsText')) && patch.limitationAdjustments === undefined) delete next.limitationAdjustments
  if (patch.limitations === 'none') { delete next.limitationsText; delete next.limitationAdjustments }
  // Changes to either schedule invalidate the trainer's previous acknowledgement.
  if (patch.otherActivity !== undefined || patch.otherActivities !== undefined || patch.weekdays !== undefined || patch.frequency !== undefined
    || clearedKeys.some((key) => ['otherActivity', 'otherActivities', 'weekdays', 'frequency'].includes(key))) delete next.activityOverlapConfirmed
  if (patch.otherActivity !== undefined && patch.otherActivities === undefined && previous.otherActivity !== patch.otherActivity) delete next.otherActivities
  if (typeof next.otherActivity === 'string' && noOtherActivity({ otherActivity: next.otherActivity })) delete next.otherActivities
  // Frequency changes cannot silently reuse an incompatible old schedule.
  if (patch.frequency !== undefined && patch.weekdays === undefined && previous.frequency !== patch.frequency) delete next.weekdays
  if (patch.goalText !== undefined && patch.goal === undefined) delete next.goal
  const brief = readProgramBrief(next)
  if (!brief) throw new Error('invalid_brief_extraction')
  return { brief, clarification }
}

export const briefQuestions: Partial<Record<keyof ProgramBrief, string>> = {
  continuationPlan: 'Продолжаем прежний подход или меняем программу? Что важно сохранить?',
  goalText: 'Какова цель именно этой четырёхнедельной программы: что хотите улучшить?',
  goal: 'Основной приоритет — сила, набор мышц, общая форма или снижение веса?',
  frequency: 'Сколько занятий в неделю планируем: одно, два или три?',
  weekdays: 'В какие дни недели удобно тренироваться?',
  durationMin: 'Сколько минут есть на одно занятие, включая разминку и отдых? В этом пилоте — от 30 минут.',
  startDate: 'С какой даты начинается четырёхнедельная программа?',
  experience: 'Какой опыт тренировок и был ли в последнее время перерыв?',
  equipment: 'Какое оборудование доступно? Можно перечислить его или указать полностью оборудованный тренажёрный зал.',
  limitations: 'Есть ли сейчас боль, травмы или ограничения для упражнений? Если нет — так и напишите.',
  limitationsText: 'Опишите ограничения: что беспокоит и при каких движениях или нагрузке?',
  limitationAdjustments: 'Какие движения, упражнения или нагрузки нужно исключить или изменить? Укажите известные рекомендации и допустимые варианты. Если это пока неизвестно, так и напишите — отмечу это в черновике для проверки тренером.',
  preferences: 'Есть ли любимые или нежелательные упражнения? Можно ответить «предпочтений нет».',
  otherActivity: 'Есть ли другая регулярная нагрузка — бег, спорт или физическая работа? Если есть, укажите вид, частоту и дни; если нет — напишите «нет».',
  otherActivities: 'Уточните другую нагрузку: какой вид, сколько раз в неделю и в какие дни? Например: бег, дважды в неделю, вторник и суббота.',
  adult: 'Клиенту уже исполнилось 18 лет?',
}

export function missingBriefFields(brief: ProgramBrief, hasHistory = false): (keyof ProgramBrief)[] {
  const missing = Object.keys(briefQuestions).filter((key) => key !== 'otherActivities' && (key !== 'continuationPlan' || hasHistory)
    && (!['limitationsText', 'limitationAdjustments'].includes(key) || brief.limitations === 'present' || brief.limitations === 'unknown')
    && brief[key as keyof ProgramBrief] === undefined) as (keyof ProgramBrief)[]
  if (brief.weekdays && brief.frequency && brief.weekdays.length !== brief.frequency && !missing.includes('weekdays')) missing.push('weekdays')
  if (activityNeedsDetails(brief)) missing.push('otherActivities')
  return missing
}

export function briefSummary(brief: ProgramBrief): string {
  const days = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
  const experience = { beginner: 'начальный', returning: 'возвращение после перерыва', experienced: 'есть опыт' }
  const equipmentNames: Record<Equipment, string> = { stationary_bike: 'Велотренажёр', dumbbells: 'гантели', barbell: 'штанга', bench: 'скамья', rack: 'стойка', cable: 'блочный тренажёр', pullup_bar: 'турник', leg_press: 'жим ногами', leg_curl: 'сгибание ног', leg_extension: 'разгибание ног' }
  return [brief.continuationPlan && `Продолжение: ${brief.continuationPlan}`, brief.preserveRefs?.length && `Сохранить упражнения: ${brief.preserveRefs.map((ref) => PROGRAM_CATALOG.find((row) => row.ref === ref)?.name).join(', ')}`, brief.goalText && `Цель: ${brief.goalText}`, brief.frequency && `${brief.frequency} занятий в неделю · 4 недели`,
    brief.weekdays && `Дни: ${brief.weekdays.map((day) => days[day - 1]).join(', ')}`,
    brief.durationMin && `До ${brief.durationMin} минут`, brief.startDate && `Начало: ${brief.startDate}`,
    brief.equipment && `Оборудование: ${brief.equipment.length ? brief.equipment.map((item) => equipmentNames[item]).join(', ') : 'без оборудования'}`,
    brief.adult !== undefined && `Совершеннолетний: ${brief.adult ? 'да' : 'нет'}`,
    brief.excludedRefs?.length && `Исключены: ${brief.excludedRefs.map((ref) => PROGRAM_CATALOG.find((row) => row.ref === ref)?.name).join(', ')}`,
    brief.experience && `Опыт: ${experience[brief.experience]}${brief.experienceText ? ` — ${brief.experienceText}` : ''}`,
    brief.limitations && `Ограничения: ${brief.limitations === 'none' ? 'не заявлены' : brief.limitationsText ?? 'нужно уточнить'}`,
    brief.limitations !== 'none' && brief.limitationAdjustments && `Учесть при подборе: ${brief.limitationAdjustments}`,
    brief.preferences && `Пожелания: ${brief.preferences}`, brief.otherActivity && `Другая нагрузка: ${brief.otherActivity}`,
    brief.otherActivities?.map((activity) => `${activity.kind}: ${activity.frequency} в неделю, ${activity.weekdays.map((day) => days[day - 1]).join(', ')}`).join('\n'),
    brief.activityOverlapConfirmed && 'Совмещение нагрузок в одни дни согласовано.',
    brief.historyComplete === false && 'История записана не полностью; используем стартовый объём.',
  ].filter(Boolean).join('\n')
}

export const CONFIRM_PROGRAM_BRIEF = 'Условия верны, составь программу'
