import type { ProgramBrief } from './brief.js'

export type BriefAnswerContext = { question: string; fields: (keyof ProgramBrief)[] }

function evenlySpacedWeekdays(frequency: ProgramBrief['frequency']): number[] | undefined {
  if (frequency === 1) return [1]
  if (frequency === 2) return [1, 4]
  if (frequency === 3) return [1, 3, 5]
  return undefined
}

/** Explicit absence is an answer, not a request to delete a field. */
export function explicitBriefAnswer(message: string, context?: BriefAnswerContext, today?: string, brief?: ProgramBrief): unknown {
  const text = message.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().replace(/[.!]$/, '')
  if (context?.fields.length === 1 && context.fields[0] === 'weekdays'
    && /^(?:да,?\s*)?(?:мне\s+)?(?:все равно|не ?важно|без разницы|любые|в любые(?: дни)?|в любой день)$/u.test(text)) {
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
      date.setUTCDate(date.getUTCDate() + delta)
      return { patch: { startDate: date.toISOString().slice(0, 10) }, clear: [], evidence: { startDate: message }, clarification: null }
    }
  }
  const field = /^(?:предпочтений нет|нет предпочтений|без предпочтений)$/u.test(text) ? 'preferences'
    : text === 'нет' && context?.fields.length === 1 && ['preferences', 'otherActivity', 'limitations'].includes(context.fields[0]!) ? context.fields[0] : undefined
  if (!field) return undefined
  return { patch: { [field]: field === 'limitations' ? 'none' : 'нет' }, clear: [], evidence: { [field]: message }, clarification: null }
}
