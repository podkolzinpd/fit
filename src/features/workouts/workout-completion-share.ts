import { completionIcons, type CompletionCelebration } from './workout-completion-celebration'
import { copyText } from '../../shared/clipboard'

export type WorkoutShareVariant = 'summary' | 'achievement' | 'progress'

export interface WorkoutShareMetric {
  label: string
  value: string
}

export interface WorkoutShareProgress {
  changePercent: number
  currentValue: string
  previousValue: string
  previousDate: string
}

export interface WorkoutShareSummary {
  title: string
  celebration?: CompletionCelebration
  date: string
  countLine: string
  metrics: WorkoutShareMetric[]
  highlightLabel: string
  highlightTitle: string
  highlightValue?: string
  highlightDelta?: string | null
  muscleGroups: string[]
  progress?: WorkoutShareProgress | null
}

export type WorkoutShareResult = 'shared' | 'copied' | 'cancelled'

export interface WorkoutSharePresentation {
  clientLime?: boolean
}

type ShareFont = (weight: 400 | 500 | 600, size: number, numeric?: boolean, secondary?: boolean) => string

function signedPercent(value: number): string {
  if (value === 0) return '0%'
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}%`
}

export function workoutShareText(summary: WorkoutShareSummary, variant: WorkoutShareVariant = 'summary'): string {
  const common = [summary.celebration?.title, summary.date, summary.countLine]
  const metrics = summary.metrics.map((metric) => metric.value).join(' · ')
  const muscles = summary.muscleGroups.length > 0 ? `Нагрузка: ${summary.muscleGroups.join(', ')}` : ''
  if (variant === 'achievement') {
    return [
      summary.highlightLabel,
      `${summary.highlightTitle}${summary.highlightValue ? ` — ${summary.highlightValue}` : ''}`,
      summary.highlightDelta ?? '',
      ...common,
      metrics,
      muscles,
      'Моя тренировка в Fit',
    ].filter(Boolean).join('\n')
  }
  if (variant === 'progress' && summary.progress) {
    return [
      'Прогресс тренировки',
      `${signedPercent(summary.progress.changePercent)} к прошлой похожей тренировке`,
      `${summary.progress.currentValue} сейчас · ${summary.progress.previousValue} — ${summary.progress.previousDate}`,
      ...common,
      muscles,
      'Моя тренировка в Fit',
    ].filter(Boolean).join('\n')
  }
  return [
    summary.title,
    ...common,
    metrics,
    `${summary.highlightLabel}: ${summary.highlightTitle}${summary.highlightValue ? ` — ${summary.highlightValue}` : ''}`,
    summary.highlightDelta ?? '',
    muscles,
    'Моя тренировка в Fit',
  ].filter(Boolean).join('\n')
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}

function fitLine(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text
  let shortened = text
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1)
  return `${shortened.trimEnd()}…`
}

function fittedFontSize(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferred: number,
  minimum: number,
  font: ShareFont,
): number {
  for (let size = preferred; size >= minimum; size -= 2) {
    context.font = font(600, size)
    if (context.measureText(text).width <= maxWidth) return size
  }
  return minimum
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.trim().split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  if (lines.length <= maxLines) return lines.map((line) => fitLine(context, line, maxWidth))
  return [
    ...lines.slice(0, maxLines - 1),
    fitLine(context, lines.slice(maxLines - 1).join(' '), maxWidth),
  ]
}

interface SharePalette {
  paper: string
  ink: string
  muted: string
  surface: string
  line: string
  success: string
}

function drawHeader(context: CanvasRenderingContext2D, summary: WorkoutShareSummary, palette: SharePalette, font: ShareFont) {
  context.fillStyle = palette.ink
  context.font = font(600, 42)
  context.fillText('FIT', 80, 105)
  context.fillStyle = palette.muted
  context.font = font(500, 28, false, true)
  context.textAlign = 'right'
  context.fillText(summary.date, 1000, 105)
  context.textAlign = 'left'
}

function drawFooter(context: CanvasRenderingContext2D, palette: SharePalette, font: ShareFont) {
  context.fillStyle = palette.muted
  context.font = font(400, 27)
  context.fillText('Моя тренировка в Fit', 80, 1245)
}

function drawMetricCards(
  context: CanvasRenderingContext2D,
  metrics: WorkoutShareMetric[],
  y: number,
  palette: SharePalette,
  font: ShareFont,
  clientLime: boolean,
) {
  const visible = metrics.slice(0, 4)
  if (visible.length === 0) return
  const gap = 20
  const width = (920 - gap * (visible.length - 1)) / visible.length
  visible.forEach((metric, index) => {
    const x = 80 + index * (width + gap)
    roundedRect(context, x, y, width, 170, 30)
    context.fillStyle = palette.surface
    context.fill()
    context.fillStyle = palette.ink
    const preferredSize = visible.length >= 4 ? 36 : 44
    const valueSize = clientLime ? fittedFontSize(context, metric.value, width - 48, preferredSize, 24, font) : preferredSize
    context.font = font(600, valueSize)
    context.fillText(fitLine(context, metric.value, width - 48), x + 24, y + 70)
    context.fillStyle = palette.muted
    context.font = font(500, 24, false, true)
    if (clientLime) wrapLines(context, metric.label, width - 48, 2).forEach((line, lineIndex) => context.fillText(line, x + 24, y + 123 + lineIndex * 28))
    else context.fillText(fitLine(context, metric.label, width - 48), x + 24, y + 123)
  })
}

function drawSummaryCard(context: CanvasRenderingContext2D, summary: WorkoutShareSummary, palette: SharePalette, font: ShareFont, clientLime: boolean) {
  context.fillStyle = palette.success
  context.font = font(500, 26)
  context.fillText('РЕЗУЛЬТАТ СОХРАНЁН', 80, 205)
  context.fillStyle = palette.ink
  context.font = font(600, 76)
  const titleLines = wrapLines(context, summary.celebration?.title ?? summary.title, summary.celebration ? 740 : 920, 2)
  titleLines.forEach((line, index) => context.fillText(line, 80, 300 + index * 82))
  const countY = titleLines.length > 1 ? 445 : 365
  context.fillStyle = palette.muted
  context.font = font(400, 34)
  context.fillText(fitLine(context, summary.countLine, 920), 80, countY)

  const metricsY = titleLines.length > 1 ? 515 : 440
  drawMetricCards(context, summary.metrics, metricsY, palette, font, clientLime)
  const highlightY = summary.metrics.length > 0 ? metricsY + 230 : countY + 75
  roundedRect(context, 80, highlightY, 920, 330, 36)
  context.fillStyle = palette.surface
  context.fill()
  context.strokeStyle = palette.line
  context.lineWidth = 2
  context.stroke()
  context.fillStyle = palette.success
  context.font = font(500, 25)
  context.fillText(summary.highlightLabel.toUpperCase(), 125, highlightY + 68)
  context.fillStyle = palette.ink
  context.font = font(600, 54)
  context.fillText(fitLine(context, summary.highlightTitle, 830), 125, highlightY + 150)
  if (summary.highlightValue) {
    context.fillStyle = palette.muted
    context.font = font(500, 34)
    context.fillText(fitLine(context, summary.highlightValue, 830), 125, highlightY + 213)
  }
  const proof = summary.highlightDelta || summary.muscleGroups.join(' · ')
  if (proof) {
    context.fillStyle = summary.highlightDelta ? palette.success : palette.muted
    context.font = font(500, 28)
    context.fillText(fitLine(context, proof, 830), 125, highlightY + 275)
  }
}

function drawAchievementCard(context: CanvasRenderingContext2D, summary: WorkoutShareSummary, palette: SharePalette, font: ShareFont, clientLime: boolean) {
  context.fillStyle = palette.success
  context.font = font(500, 26)
  context.fillText('ДОСТИЖЕНИЕ', 80, 205)
  context.fillStyle = palette.ink
  context.font = font(600, 74)
  context.fillText(fitLine(context, summary.highlightLabel, 920), 80, 305)

  roundedRect(context, 80, 380, 920, 470, 42)
  context.fillStyle = palette.surface
  context.fill()
  context.strokeStyle = palette.line
  context.lineWidth = 2
  context.stroke()
  context.fillStyle = palette.ink
  context.font = font(600, 58)
  const titleLines = wrapLines(context, summary.highlightTitle, 820, 2)
  titleLines.forEach((line, index) => context.fillText(line, 130, 490 + index * 66))
  const valueY = titleLines.length > 1 ? 670 : 610
  if (summary.highlightValue) {
    context.fillStyle = palette.success
    const valueSize = fittedFontSize(context, summary.highlightValue, 820, 68, 38, font)
    context.font = font(600, valueSize)
    context.fillText(fitLine(context, summary.highlightValue, 820), 130, valueY)
  }
  if (summary.highlightDelta) {
    context.fillStyle = palette.muted
    context.font = font(500, 31, false, true)
    context.fillText(fitLine(context, summary.highlightDelta, 820), 130, valueY + 70)
  }
  context.fillStyle = palette.muted
  context.font = font(400, 29)
  context.fillText(fitLine(context, summary.countLine, 820), 130, 790)
  drawMetricCards(context, summary.metrics.filter((metric) => metric.label !== 'План').slice(0, 3), 920, palette, font, clientLime)
}

function drawProgressCard(context: CanvasRenderingContext2D, summary: WorkoutShareSummary, palette: SharePalette, font: ShareFont, clientLime: boolean) {
  const progress = summary.progress
  if (!progress) return drawSummaryCard(context, summary, palette, font, clientLime)
  context.fillStyle = palette.success
  context.font = font(500, 26)
  context.fillText('ПРОГРЕСС ТРЕНИРОВКИ', 80, 205)
  context.fillStyle = palette.ink
  context.font = font(600, 68)
  context.fillText('Объём относительно', 80, 300)
  context.fillText('похожей тренировки', 80, 375)
  context.fillStyle = palette.success
  context.font = font(600, 150, true)
  context.fillText(signedPercent(progress.changePercent), 80, 575)
  context.fillStyle = palette.muted
  context.font = font(500, 30, false, true)
  context.fillText(`Сравнение с ${progress.previousDate}`, 85, 630)

  roundedRect(context, 80, 710, 920, 250, 38)
  context.fillStyle = palette.surface
  context.fill()
  context.fillStyle = palette.ink
  context.font = font(600, 58)
  context.fillText(fitLine(context, progress.currentValue, 390), 130, 825)
  context.fillText(fitLine(context, progress.previousValue, 390), 590, 825)
  context.fillStyle = palette.muted
  context.font = font(500, 25, false, true)
  context.fillText('сейчас', 130, 880)
  context.fillText('прошлая похожая', 590, 880)
  context.fillStyle = palette.line
  context.fillRect(540, 760, 2, 150)
  context.fillStyle = palette.muted
  context.font = font(400, 30)
  context.fillText(fitLine(context, summary.countLine, 920), 80, 1050)
  if (summary.muscleGroups.length > 0) {
    context.fillText(fitLine(context, `Нагрузка · ${summary.muscleGroups.join(' · ')}`, 920), 80, 1110)
  }
}

function loadCelebrationArt(source: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = window.setTimeout(() => resolve(null), 2000)
    image.onload = () => { window.clearTimeout(timer); resolve(image) }
    image.onerror = () => { window.clearTimeout(timer); resolve(null) }
    image.src = source
  })
}

async function workoutShareFile(
  summary: WorkoutShareSummary,
  variant: WorkoutShareVariant,
  presentation: WorkoutSharePresentation,
): Promise<File | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const context = canvas.getContext('2d')
  if (!context) return null
  const clientLime = presentation.clientLime === true
  const font: ShareFont = (weight, size, numeric = false, secondary = false) => clientLime
    ? numeric ? `700 ${size}px REM, sans-serif` : `${secondary || weight === 400 ? 400 : 500} ${size}px "YS Geo Symbols", "YS Geo", sans-serif`
    : `${weight} ${size}px Onest, Arial, sans-serif`
  let palette: SharePalette = {
    paper: '#FBFAF7',
    ink: '#242426',
    muted: '#74736F',
    surface: '#EFEDE8',
    line: '#DEDBD4',
    success: '#2F6B4F',
  }
  if (clientLime) {
    const frame = document.querySelector('.phone-frame.fit-client-lime')
    if (!frame || !document.fonts) return null
    const styles = getComputedStyle(frame)
    const token = (name: string) => styles.getPropertyValue(name).trim()
    palette = {
      paper: token('--lime-bg'), ink: token('--lime-text'), muted: token('--lime-text-secondary'),
      surface: token('--lime-surface-raised'), line: token('--lime-divider'), success: token('--success-fg'),
    }
    if (Object.values(palette).some((value) => !value)) return null
    // fonts.ready alone does not request the faces used only by this canvas.
    const requests = [
      document.fonts.load('400 16px "YS Geo"', 'Тренировка ё 0123'),
      document.fonts.load('500 16px "YS Geo"', 'Результат ё 0123'),
      document.fonts.load('500 16px "YS Geo Symbols"', '≈'),
      ...(variant === 'progress' && summary.progress ? [document.fonts.load('700 16px REM', '0123%+−')] : []),
    ]
    if ((await Promise.all(requests)).some((faces) => faces.length === 0)) return null
  }
  await document.fonts?.ready
  context.fillStyle = palette.paper
  context.fillRect(0, 0, canvas.width, canvas.height)
  drawHeader(context, summary, palette, font)
  if (variant === 'achievement') drawAchievementCard(context, summary, palette, font, clientLime)
  else if (variant === 'progress') drawProgressCard(context, summary, palette, font, clientLime)
  else drawSummaryCard(context, summary, palette, font, clientLime)
  if (summary.celebration) {
    // Reuse the tiny same-origin asset already shown on screen. A failed image
    // must not prevent sharing the saved facts.
    const art = await loadCelebrationArt(completionIcons[summary.celebration.icon])
    if (variant === 'summary') {
      if (art) context.drawImage(art, 850, 215, 150, 150)
    } else {
      if (art) context.drawImage(art, 80, 1140, 64, 64)
      context.fillStyle = palette.ink
      context.font = font(500, 28)
      wrapLines(context, summary.celebration.title, 830, 2).forEach((line, index) => context.fillText(line, 160, 1165 + index * 34))
    }
  }
  drawFooter(context, palette, font)

  if (clientLime) {
    // Freeze the rendered pixels before encoding. Direct toBlob on WebKit can
    // drop already measured/drawn text; a copied readback preserves the image.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), canvas.width, canvas.height), 0, 0)
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], `fit-workout-${variant}.png`, { type: 'image/png' }) : null
}

export async function shareWorkoutSummary(
  summary: WorkoutShareSummary,
  variant: WorkoutShareVariant = 'summary',
  presentation: WorkoutSharePresentation = {},
): Promise<WorkoutShareResult> {
  const text = workoutShareText(summary, variant)
  if (navigator.share) {
    const file = await workoutShareFile(summary, variant, presentation).catch(() => null)
    const data: ShareData = { title: 'Моя тренировка в Fit', text }
    if (file && navigator.canShare?.({ files: [file] })) data.files = [file]
    try {
      await navigator.share(data)
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  await copyText(text)
  return 'copied'
}
