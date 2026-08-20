import { describe, expect, it } from 'vitest'
import { progressFactChangeLabel } from './progress-facts'

describe('progressFactChangeLabel', () => {
  it('formats strength without unnecessary decimals', () => {
    expect(progressFactChangeLabel({
      metric: 'max_weight', from: 50, to: 68, changePercent: 36, favorable: true,
    })).toBe('Рабочий вес: 50 → 68 кг · +36%')
  })

  it('formats pace as minutes per kilometre and explains the direction', () => {
    expect(progressFactChangeLabel({
      metric: 'pace', from: 6, to: 5.4, changePercent: -10, favorable: true,
    })).toBe('Темп: 6:00 → 5:24/км · быстрее на 10%')
  })

  it('uses at most one decimal and a readable minus sign', () => {
    expect(progressFactChangeLabel({
      metric: 'distance', from: 5.25, to: 4.8, changePercent: -9, favorable: false,
    })).toBe('Дистанция за тренировку: 5,3 → 4,8 км · −9%')
  })
})
