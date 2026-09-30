import { expect, it } from 'vitest'
import { explicitBriefAnswer, type BriefAnswerContext } from './answer.js'
import { mergeExtractedBrief } from './brief.js'

it.each(['предпочтений нет', 'нет предпочтений', 'Без предпочтений.'])('records absence without clearing pain: %s', (message) => {
  const previous = { limitations: 'present' as const, limitationsText: 'болит плечо', otherActivity: 'бег' }
  expect(mergeExtractedBrief(previous, message, explicitBriefAnswer(message)).brief).toEqual({ ...previous, preferences: 'нет' })
})

it.each(['preferences', 'otherActivity', 'limitations'] as const)('scopes a short negative to the asked field %s', (field) => {
  const message = 'Нет!'
  expect(mergeExtractedBrief({}, message, explicitBriefAnswer(message, { question: 'Вопрос', fields: [field] })).brief)
    .toEqual({ [field]: field === 'limitations' ? 'none' : 'нет' })
})

it('leaves ambiguous negatives and substantive preferences to the model', () => {
  expect(explicitBriefAnswer('нет')).toBeUndefined()
  expect(explicitBriefAnswer('нет', { question: 'Два вопроса', fields: ['limitations', 'preferences'] })).toBeUndefined()
  expect(explicitBriefAnswer('нет, приседания не хочу')).toBeUndefined()
})

it('records unknown adaptations without erasing the stated limitation', () => {
  const message = 'пока неизвестно'
  const result = mergeExtractedBrief({ limitations: 'present', limitationsText: 'Дискомфорт при нагрузке' }, message,
    explicitBriefAnswer(message, { question: 'Какие изменения нужны?', fields: ['limitationAdjustments'] }))
  expect(result.brief).toMatchObject({ limitations: 'present', limitationAdjustments: message })
})

it.each([
  ['2026-09-16', 'со следующего понедельника', '2026-09-21'],
  ['2026-09-21', 'со следующего понедельника', '2026-09-28'],
  ['2026-12-31', 'со следующего понедельника', '2027-01-04'],
])('resolves a named next weekday by the calendar from %s', (today, message, expected) => {
  expect(mergeExtractedBrief({}, message, explicitBriefAnswer(message, undefined, today)).brief.startDate).toBe(expected)
})

it.each([
  ['2026-09-30', 'Сегодня', '2026-09-30'],
  ['2026-09-30', 'завтра', '2026-10-01'],
  ['2026-12-31', 'Завтра.', '2027-01-01'],
])('resolves a relative start date by the calendar from %s', (today, message, expected) => {
  const context: BriefAnswerContext = { question: 'С какой даты начинается программа?', fields: ['startDate'] }
  expect(mergeExtractedBrief({}, message, explicitBriefAnswer(message, context, today)).brief.startDate).toBe(expected)
})

it.each([
  ['60', 60],
  ['60 минут', 60],
  ['40-60', 40],
  ['40–60 минут', 40],
] as const)('accepts a duration answer scoped to the duration question: %s', (message, durationMin) => {
  const context: BriefAnswerContext = { question: 'Сколько минут есть?', fields: ['durationMin'] }
  expect(mergeExtractedBrief({}, message, explicitBriefAnswer(message, context)).brief.durationMin).toBe(durationMin)
})

it('does not reinterpret a bare number as duration outside the duration question', () => {
  expect(explicitBriefAnswer('60', { question: 'Сколько занятий?', fields: ['frequency'] })).toBeUndefined()
})

it.each([
  ['Тренировки дома. Есть гиря 5 кг и резинки', ['kettlebells', 'resistance_bands']],
  ['Гири и эспандер', ['kettlebells', 'resistance_bands']],
  ['Гантели, скамья и турник', ['dumbbells', 'bench', 'pullup_bar']],
] as const)('extracts only explicitly named equipment: %s', (message, equipment) => {
  const context: BriefAnswerContext = { question: 'Какое оборудование доступно?', fields: ['equipment'] }
  expect(mergeExtractedBrief({}, message, explicitBriefAnswer(message, context)).brief.equipment).toEqual(equipment)
})

it.each([
  ['Да все равно', 1, [1]],
  ['Не важно', 2, [1, 4]],
  ['В любые', 3, [1, 3, 5]],
  ['без разницы.', 3, [1, 3, 5]],
] as const)('uses a stable rest-day schedule for an indifferent weekday answer: %s', (message, frequency, weekdays) => {
  const previous = { frequency }
  const result = mergeExtractedBrief(previous, message, explicitBriefAnswer(message,
    { question: 'В какие дни недели удобно тренироваться?', fields: ['weekdays'] }, undefined, previous))
  expect(result.brief).toEqual({ frequency, weekdays })
})

it('does not infer weekdays from an indifferent answer outside the weekday question', () => {
  expect(explicitBriefAnswer('Не важно', { question: 'Какова цель?', fields: ['goalText'] }, undefined, { frequency: 3 })).toBeUndefined()
  expect(explicitBriefAnswer('В любые', { question: 'В какие дни?', fields: ['weekdays'] })).toBeUndefined()
})
