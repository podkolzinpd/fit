import { describe, expect, it } from 'vitest'
import { bodyMapInsight } from './body-map-insight'
import type { BodyMapData, BodyMapRegion } from './body-progress-map'

const region: BodyMapRegion = {
  group: 'upper_back',
  label: 'Верх спины',
  percent: 36,
  valueLabel: '+36%',
  metricLabel: 'Лучший результат зоны',
  primaryDetail: 'Тяга верхнего блока · Рабочий вес: 50 → 68 кг',
  details: ['Тяга нижнего блока · Рабочий вес: 60 → 75 кг'],
  intensity: .72,
}

const progress: BodyMapData = {
  mode: 'progress',
  title: 'Где выросли результаты',
  description: 'Изменения по подтверждённым результатам упражнений',
  regions: [region],
  emptyMessage: 'Нет данных',
}

describe('bodyMapInsight', () => {
  it('accepts a short LLM explanation only when it is grounded in the selected zone fact', () => {
    expect(bodyMapInsight(progress, region, [
      'В тяге верхнего блока подтверждено изменение +36%; это главный результат выбранной зоны.',
    ])).toEqual(expect.objectContaining({
      source: 'llm',
      factId: 'body-map:progress:upper_back:+36%',
    }))
  })

  it('rejects invented values and training prescriptions', () => {
    const invented = bodyMapInsight(progress, region, ['Тяга верхнего блока выросла на +50%.'])
    const prescription = bodyMapInsight(progress, region, ['Нужно увеличить тягу верхнего блока на +36%.'])

    expect(invented.source).toBe('deterministic')
    expect(prescription.source).toBe('deterministic')
    expect(prescription.text).toBe('В зоне «Верх спины» лучший подтверждённый результат изменился на +36%.')
  })

  it('explains load from the calculated share without asking the LLM to infer it', () => {
    const load = { ...progress, mode: 'load' as const }
    const loadRegion = { ...region, valueLabel: '33%' }

    expect(bodyMapInsight(load, loadRegion, [])).toEqual({
      factId: 'body-map:load:upper_back:33%',
      source: 'deterministic',
      text: 'На зону «Верх спины» приходится 33% всех выполненных подходов.',
    })
  })
})
