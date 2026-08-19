const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

const metricForms = {
  workout: ['тренировка', 'тренировки', 'тренировок'],
  activeWeek: ['активная неделя', 'активные недели', 'активных недель'],
  gapDay: ['день без тренировок', 'дня без тренировок', 'дней без тренировок'],
} as const

function numeric(value: string): number {
  return Number(value.replace(',', '.'))
}

export function formatWorkoutsPerWeek(value: number): string {
  return oneDecimal.format(value)
}

export function progressMetricNoun(value: number, metric: keyof typeof metricForms): string {
  const mod100 = Math.abs(value) % 100
  const mod10 = Math.abs(value) % 10
  const [one, few, many] = metricForms[metric]
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function formatSummaryText(value: string): string {
  return value
    .replace(/\s*\/\s*нед\./gi, ' в неделю')
    .replace(/(-?\d+(?:[.,]\d+)?)\s*%/g, (match, raw: string) => {
      const parsed = numeric(raw)
      return Number.isFinite(parsed) ? `${Math.round(parsed)}%` : match
    })
    .replace(
      /(-?\d+(?:[.,]\d+)?)(?=\s*(?:\/\s*нед\.?|в\s+недел(?:ю|и)))/gi,
      (match, raw: string) => {
        const parsed = numeric(raw)
        return Number.isFinite(parsed) ? oneDecimal.format(parsed) : match
      },
    )
}
