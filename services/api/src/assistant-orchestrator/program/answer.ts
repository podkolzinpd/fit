import type { ProgramBrief } from './brief.js'
import type { Equipment } from './catalog.js'

export type BriefAnswerContext = { question: string; fields: (keyof ProgramBrief)[] }

function evenlySpacedWeekdays(frequency: ProgramBrief['frequency']): number[] | undefined {
  if (frequency === 1) return [1]
  if (frequency === 2) return [1, 4]
  if (frequency === 3) return [1, 3, 5]
  return undefined
}

function addDays(date: string, days: number): string | undefined {
  const value = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(value.getTime())) return undefined
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function explicitDuration(text: string): number | undefined {
  const match = text.match(/^(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?:\s*(?:мин|минута|минуты|минут))?$/u)
  if (!match) return undefined
  const values = [Number(match[1]), match[2] === undefined ? undefined : Number(match[2])]
    .filter((value): value is number => value !== undefined)
  if (values.some((value) => !Number.isInteger(value) || value < 15 || value > 120)) return undefined
  // A program must fit even on the shorter day from an explicitly stated range.
  return Math.min(...values)
}

function explicitEquipment(text: string): Equipment[] | undefined {
  const equipment: Equipment[] = []
  const add = (value: Equipment) => { if (!equipment.includes(value)) equipment.push(value) }
  if (/(?<!\p{L})гир(?:я|и|ю|ей|ь|ек|ями|ях)?(?!\p{L})/u.test(text)) add('kettlebells')
  if (/(?<!\p{L})(?:резин(?:а|ы|ка|ки|ку|ке|кой|ок|ками|ках)?|эспандер(?:а|ы|ом|ов|ами|ах)?)(?!\p{L})/u.test(text)) add('resistance_bands')
  if (/(?<!\p{L})гантел(?:ь|и|ей|ями|ях)?(?!\p{L})/u.test(text)) add('dumbbells')
  if (/(?<!\p{L})штанг(?:а|и|у|ой|е)?(?!\p{L})/u.test(text)) add('barbell')
  if (/(?<!\p{L})(?:скам(?:ья|ьи|ью|ье)|лавк(?:а|и|у|ой|е))(?!\p{L})/u.test(text)) add('bench')
  if (/(?<!\p{L})(?:турник|перекладин(?:а|ы|у|ой|е))(?!\p{L})/u.test(text)) add('pullup_bar')
  if (/(?<!\p{L})велотренажер(?:а|ы|ом|е)?(?!\p{L})/u.test(text)) add('stationary_bike')
  return equipment.length ? equipment : undefined
}

/** Explicit absence is an answer, not a request to delete a field. */
export function explicitBriefAnswer(message: string, context?: BriefAnswerContext, today?: string, brief?: ProgramBrief): unknown {
  const text = message.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().replace(/[.!]$/, '')
  if (context?.fields.length === 1 && context.fields[0] === 'otherActivity'
    && /^(?:бег\s+)?(?:2|два|дважды)\s*раз(?:а)?(?:\s+(?:в|за)\s+недел[юи])?\s*[:,—–-]?\s*(?:во?\s+)?вторник(?:ам|и)?\s*(?:и|,)\s*(?:в|по\s+)?суббот(?:а|у|ы|ам|ами)?$/u.test(text)) {
    return {
      patch: { otherActivity: message, otherActivities: [{ kind: 'бег', frequency: 2, weekdays: [2, 6] }] },
      clear: [],
      evidence: { otherActivity: message, otherActivities: message },
      clarification: null,
    }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'continuationPlan') {
    if (/^(?:продолжаем|продолжить)(?:\s+(?:без изменений|как есть|тот же курс|прежний курс|тот же подход))?$/u.test(text)) {
      return { patch: { continuationPlan: message }, clear: [], evidence: { continuationPlan: message }, clarification: null }
    }
    if (/^(?:меняем|изменить|новая)\s+(?:программу|подход|курс)$/u.test(text)) {
      return { patch: { continuationPlan: message }, clear: [], evidence: { continuationPlan: message }, clarification: null }
    }
  }
  if (context?.fields.length === 1 && ['goalText', 'goal'].includes(context.fields[0]!)) {
    const goal = /^(?:сила|стать сильнее|силовая)$/u.test(text) ? 'strength'
      : /^(?:набор мышц|набрать мышцы|мышечная масса|гипертрофия)$/u.test(text) ? 'hypertrophy'
        : /^(?:общая форма|поддерживать форму|быть в форме)$/u.test(text) ? 'general_fitness'
          : /^(?:снижение веса|снизить вес|похудеть|похудение)$/u.test(text) ? 'weight_loss' : undefined
    if (goal) return { patch: { goalText: message, goal }, clear: [], evidence: { goalText: message, goal: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'experience') {
    if (/^(?:новичок|опыта нет|раньше не тренировался|раньше не тренировалась)$/u.test(text)) {
      return { patch: { experience: 'beginner', experienceText: message }, clear: [], evidence: { experience: message, experienceText: message }, clarification: null }
    }
    if (/(?:был|была|после|возвращаюсь|возвращение).{0,30}перерыв|перерыв.{0,30}(?:был|была|месяц|недел|год)/u.test(text)) {
      return { patch: { experience: 'returning', experienceText: message }, clear: [], evidence: { experience: message, experienceText: message }, clarification: null }
    }
    if (/^(?:опыт есть|есть опыт|тренируюсь регулярно|без перерыва)$/u.test(text)) {
      return { patch: { experience: 'experienced', experienceText: message }, clear: [], evidence: { experience: message, experienceText: message }, clarification: null }
    }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'scope') {
    if (/^(?:одн(?:у|а)\s+)?тренировк(?:у|а)$/u.test(text)) return { patch: { scope: 'single_workout' }, clear: [], evidence: { scope: message }, clarification: null }
    if (/^программ(?:у|а)(?:\s+тренировок)?$/u.test(text)) return { patch: { scope: 'program' }, clear: [], evidence: { scope: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'weeks') {
    const values: Record<string, number> = { одну: 1, одна: 1, один: 1, две: 2, два: 2, три: 3, четыре: 4, месяц: 4 }
    const match = text.match(/^(одну|одна|один|две|два|три|четыре|[1-4])(?:\s+недел(?:ю|и|ь))?$|^(месяц)$/u)
    const value = match?.[1] ?? match?.[2]
    const weeks = value ? values[value] ?? Number(value) : undefined
    if (weeks) return { patch: { weeks }, clear: [], evidence: { weeks: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'durationMin') {
    const durationMin = explicitDuration(text)
    if (durationMin !== undefined) return { patch: { durationMin }, clear: [], evidence: { durationMin: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'startDate' && today) {
    const startDate = text === 'сегодня' ? today : text === 'завтра' ? addDays(today, 1) : undefined
    if (startDate) return { patch: { startDate }, clear: [], evidence: { startDate: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'equipment') {
    const equipment = explicitEquipment(text)
    if (equipment) return { patch: { equipment }, clear: [], evidence: { equipment: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'limitations'
    && /(?:^|\s)(?:бол\p{L}*|травм\p{L}*|ограничен\p{L}*|дискомфорт\p{L}*)/u.test(text)) {
    return { patch: { limitations: 'present', limitationsText: message }, clear: [],
      evidence: { limitations: message, limitationsText: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'weekdays'
    && /^(?:да,?\s*)?(?:мне\s+)?(?:все равно|не ?важно|дни не важны|без разницы|любые|в любые(?: дни)?|в любой день)$/u.test(text)) {
    const weekdays = evenlySpacedWeekdays(brief?.frequency)
    if (weekdays) return { patch: { weekdays }, clear: [], evidence: { weekdays: message }, clarification: null }
  }
  if (context?.fields.length === 1 && context.fields[0] === 'limitationAdjustments' && ['пока неизвестно', 'неизвестно', 'не знаю'].includes(text)) {
    return { patch: { limitationAdjustments: message }, clear: [], evidence: { limitationAdjustments: message }, clarification: null }
  }
  const nextDay = text.match(/^(?:со? )?следующего (понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья)$/u)
  if (nextDay && today) {
    const weekdays = ['воскресенья', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы']
    const date = new Date(`${today}T00:00:00Z`)
    if (Number.isFinite(date.getTime())) {
      const delta = (weekdays.indexOf(nextDay[1]!) - date.getUTCDay() + 7) % 7 || 7
      const startDate = addDays(today, delta)
      if (startDate) return { patch: { startDate }, clear: [], evidence: { startDate: message }, clarification: null }
    }
  }
  const field = /^(?:предпочтений нет|нет предпочтений|без предпочтений)$/u.test(text) ? 'preferences'
    : text === 'нет' && context?.fields.length === 1 && ['preferences', 'otherActivity', 'limitations'].includes(context.fields[0]!) ? context.fields[0] : undefined
  if (!field) return undefined
  return { patch: { [field]: field === 'limitations' ? 'none' : 'нет' }, clear: [], evidence: { [field]: message }, clarification: null }
}
