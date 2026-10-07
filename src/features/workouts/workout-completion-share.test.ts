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

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')

afterEach(() => {
  document.querySelector('.phone-frame.fit-client-lime')?.remove()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
})

function mockCanvasRendering() {
  const painted: { text: string; font: string; color: string | CanvasGradient | CanvasPattern }[] = []
  const fillText = vi.fn((text: string) => painted.push({ text, font: context.font, color: context.fillStyle }))
  const drawImage = vi.fn()
  const fillRect = vi.fn()
  const measureText = vi.fn((text: string) => ({ width: text.length * 18 }))
  const context = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect,
    drawImage,
    fillText,
    measureText,
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['png'], { type: 'image/png' }))
  })
  return { context, fillText, drawImage, painted, fillRect, measureText }
}

describe('workout completion sharing', () => {
  it.each(['summary', 'achievement', 'progress'] as const)('reuses the selected phrase and icon in %s without private feedback', async (variant) => {
    const { drawImage, fillText } = mockCanvasRendering()
    const images: HTMLImageElement[] = []
    vi.stubGlobal('Image', class {
      onload?: () => void
      set src(value: string) { expect(value).toContain('fist.webp'); images.push(this as unknown as HTMLImageElement); this.onload?.() }
    })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
    const selected = { ...summary, celebration: { title: 'Вот это мощь!', icon: 'fist' as const } }
    await expect(shareWorkoutSummary(selected, variant)).resolves.toBe('shared')
    expect(workoutShareText(selected, variant)).toContain('Вот это мощь!')
    expect(drawImage).toHaveBeenCalledWith(images[0], expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number))
    expect(fillText).toHaveBeenCalledWith('Вот это мощь!', expect.any(Number), expect.any(Number))
    vi.unstubAllGlobals()
  })

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


function mockLimeResources(load = vi.fn().mockResolvedValue([{}])) {
  vi.stubGlobal('ImageData', class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} })
  const frame = document.createElement('div')
  frame.className = 'phone-frame fit-client-lime'
  Object.entries({ '--lime-bg': '#000000', '--lime-text': '#ffffff', '--lime-text-secondary': '#b8b8bd', '--lime-surface-raised': '#252529', '--lime-divider': '#3b3b40', '--success-fg': '#8fc7a8' }).forEach(([name, value]) => frame.style.setProperty(name, value))
  document.body.append(frame)
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load, ready: Promise.resolve() } })
  const share = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) })
  return { load, share }
}

describe('client Lime workout PNG', () => {
  it.each(['summary', 'achievement', 'progress'] as const)('uses loaded identity resources in %s and preserves shared facts', async (variant) => {
    const { painted, fillRect } = mockCanvasRendering()
    const { load, share } = mockLimeResources()
    await expect(shareWorkoutSummary(summary, variant, { clientLime: true })).resolves.toBe('shared')
    expect(load).toHaveBeenCalledWith('400 16px "YS Geo"', expect.any(String))
    expect(load).toHaveBeenCalledWith('500 16px "YS Geo"', expect.any(String))
    expect(load).toHaveBeenCalledWith('500 16px "YS Geo Symbols"', '≈')
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350)
    expect(painted.find((item) => item.text === summary.date)?.font).toContain('400 28px')
    expect(painted.find((item) => item.text === summary.date)?.color).toBe('#b8b8bd')
    expect(painted.every((item) => !item.font.includes('Onest') && /^(400|500|700) /.test(item.font))).toBe(true)
    if (variant === 'progress') {
      expect(load).toHaveBeenCalledWith('700 16px REM', expect.any(String))
      expect(painted.find((item) => item.text === '+20%')?.font).toBe('700 150px REM, sans-serif')
    }
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: workoutShareText(summary, variant), files: [expect.objectContaining({ type: 'image/png' })] }))
  })

  it('does not measure or draw before the requested font faces finish loading', async () => {
    const { painted, measureText } = mockCanvasRendering()
    let release!: (faces: unknown[]) => void
    const loading = new Promise<unknown[]>((resolve) => { release = resolve })
    const { share } = mockLimeResources(vi.fn().mockReturnValue(loading))
    const result = shareWorkoutSummary(summary, 'summary', { clientLime: true })
    await Promise.resolve()
    expect(measureText).not.toHaveBeenCalled()
    expect(painted).toHaveLength(0)
    expect(share).not.toHaveBeenCalled()
    release([{}])
    await expect(result).resolves.toBe('shared')
    expect(measureText).toHaveBeenCalled()
  })

  it.each(['rejected', 'missing'] as const)('keeps the existing text fallback when identity fonts are %s', async (failure) => {
    const { painted } = mockCanvasRendering()
    const load = failure === 'rejected' ? vi.fn().mockRejectedValue(new Error('font unavailable')) : vi.fn().mockResolvedValue([])
    const { share } = mockLimeResources(load)
    await expect(shareWorkoutSummary(summary, 'summary', { clientLime: true })).resolves.toBe('shared')
    expect(painted).toHaveLength(0)
    expect(share).toHaveBeenCalledWith({ title: 'Моя тренировка в Fit', text: workoutShareText(summary) })
  })

  it('preserves the original export when the client flag is absent', async () => {
    const { painted } = mockCanvasRendering()
    const { load } = mockLimeResources()
    await expect(shareWorkoutSummary(summary)).resolves.toBe('shared')
    expect(load).not.toHaveBeenCalled()
    expect(painted.find((item) => item.text === 'FIT')).toMatchObject({ font: '600 42px Onest, Arial, sans-serif', color: '#242426' })
  })
})
