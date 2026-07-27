import { describe, expect, it } from 'vitest'
import type { CustomMetric } from '../../shared/domain'
import { MEASURE_PRESETS, groupMetricRows, presetMetricNames } from './measure-presets'

const metric = (name: string, unit: string | null = 'см'): CustomMetric =>
  ({ id: name, clientId: 'c', name, unit, archivedAt: null, version: 1 })

describe('пресеты замеров', () => {
  it('одиночный пресет даёт одно имя, парный — две стороны (левое/правое)', () => {
    expect(presetMetricNames({ base: 'Живот', paired: false })).toEqual(['Живот'])
    expect(presetMetricNames({ base: 'Бедро', paired: true })).toEqual(['Бедро (левое)', 'Бедро (правое)'])
  })

  it('в наборе пресетов есть живот и четыре парных обхвата', () => {
    expect(MEASURE_PRESETS.find((p) => p.id === 'belly')?.paired).toBe(false)
    expect(MEASURE_PRESETS.filter((p) => p.paired).map((p) => p.base))
      .toEqual(['Бедро', 'Плечо', 'Предплечье', 'Икра'])
  })
})

describe('группировка строк формы', () => {
  it('парные метрики сводятся в одну строку с обеими сторонами', () => {
    const rows = groupMetricRows([metric('Бедро (левое)'), metric('Бедро (правое)'), metric('Живот')])
    expect(rows).toHaveLength(2)
    const [pair, single] = rows
    expect(pair?.kind).toBe('pair')
    expect(single?.kind).toBe('single')
    if (pair?.kind !== 'pair') throw new Error('ожидалась парная строка')
    expect(pair.base).toBe('Бедро')
    expect(pair.left?.name).toBe('Бедро (левое)')
    expect(pair.right?.name).toBe('Бедро (правое)')
  })

  it('одинокая сторона пары всё равно рендерится (без второй стороны)', () => {
    const [row] = groupMetricRows([metric('Плечо (правое)')])
    if (row?.kind !== 'pair') throw new Error('ожидалась парная строка')
    expect(row.left).toBeUndefined()
    expect(row.right?.name).toBe('Плечо (правое)')
  })
})
