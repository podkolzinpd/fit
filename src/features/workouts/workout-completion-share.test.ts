import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareWorkoutSummary, workoutShareText, type WorkoutShareSummary } from './workout-completion-share'

const summary: WorkoutShareSummary = {
  title: 'Тренировка завершена',
  date: '16 сентября',
  countLine: '5 упражнений · 13 подходов',
  metrics: [{ label: 'Время', value: '42 мин' }, { label: 'С устройства', value: '321 ккал' }],
  highlightLabel: 'Личный рекорд',
  highlightTitle: 'Жим штанги лёжа',
  highlightValue: '70 кг × 12 повт.',
  highlightDelta: '+120 кг·повт. к прошлому результату',
  muscleGroups: ['Грудь', 'Трицепс'],
  progress: {
    changePercent: 20,
    currentValue: '3.8 т',
    previousValue: '3.2 т',
    previousDate: '9 сентября',
  },
}

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
})

function mockCanvasRendering() {
  const fillText = vi.fn()
  const context = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText,
    measureText: vi.fn((text: string) => ({ width: text.length * 18 })),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['png'], { type: 'image/png' }))
  })
  return { context, fillText }
}

describe('workout completion sharing', () => {
  it('builds a compact post without private feedback', () => {
    expect(workoutShareText(summary)).toBe([
      'Тренировка завершена',
      '16 сентября',
      '5 упражнений · 13 подходов',
      '42 мин · 321 ккал',
      'Личный рекорд: Жим штанги лёжа — 70 кг × 12 повт.',
      '+120 кг·повт. к прошлому результату',
      'Нагрузка: Грудь, Трицепс',
      'Моя тренировка в Fit',
    ].join('\n'))
  })

  it('builds distinct achievement and progress stories', () => {
    expect(workoutShareText(summary, 'achievement')).toContain('Личный рекорд\nЖим штанги лёжа — 70 кг × 12 повт.')
    expect(workoutShareText(summary, 'progress')).toContain('+20% к прошлой похожей тренировке')
    expect(workoutShareText(summary, 'progress')).toContain('3.8 т сейчас · 3.2 т — 9 сентября')
  })

  it('uses the native share sheet when it is available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    await expect(shareWorkoutSummary(summary)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: 'Моя тренировка в Fit', text: workoutShareText(summary) }))
  })

  it('treats closing the native share sheet as a neutral cancellation', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')) })
    await expect(shareWorkoutSummary(summary)).resolves.toBe('cancelled')
  })

  it.each(['summary', 'achievement', 'progress'] as const)(
    'renders and shares a 1080×1350 %s PNG',
    async (variant) => {
      const { fillText } = mockCanvasRendering()
      const share = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', { configurable: true, value: share })
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })

      await expect(shareWorkoutSummary(summary, variant)).resolves.toBe('shared')

      expect(fillText).toHaveBeenCalled()
      expect(share).toHaveBeenCalledWith(expect.objectContaining({
        files: [expect.objectContaining({ name: `fit-workout-${variant}.png`, type: 'image/png' })],
      }))
    },
  )

  it('falls back to the summary story when progress data is unavailable', async () => {
    const withoutProgress = { ...summary, progress: null, muscleGroups: [], metrics: [] }
    const { fillText } = mockCanvasRendering()
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })

    await expect(shareWorkoutSummary(withoutProgress, 'progress')).resolves.toBe('shared')
    expect(fillText).toHaveBeenCalledWith('РЕЗУЛЬТАТ СОХРАНЁН', 80, 205)
  })
})
