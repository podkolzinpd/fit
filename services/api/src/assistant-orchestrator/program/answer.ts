import type { ProgramBrief } from './brief.js'

export type BriefAnswerContext = { question: string; fields: (keyof ProgramBrief)[] }

/** Explicit absence is an answer, not a request to delete a field. */
export function explicitBriefAnswer(message: string, context?: BriefAnswerContext, today?: string): unknown {
  const text = message.toLocaleLowerCase('ru').replace(/ё/g, 'е').trim().replace(/[.!]$/, '')
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
