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
    .replace(/workouts_per_week\s*(?:составляет|равен|—|=)?\s*(-?\d+(?:[.,]\d+)?)/gi, (_match, raw: string) => {
      const parsed = numeric(raw)
      return Number.isFinite(parsed)
        ? `частота — ${oneDecimal.format(parsed)} тренировки в неделю`
        : 'частота тренировок'
    })
    .replace(/longest_gap_days\s*(?:составляет|равен|—|=)?\s*(\d+)\s*(?:день|дня|дней)?/gi, (_match, raw: string) => {
      const days = Number(raw)
      return `максимальный перерыв — ${raw} ${progressMetricNoun(days, 'gapDay').replace(' без тренировок', '')}`
    })
    .replace(/active_weeks/gi, 'активных недель')
    .replace(/completed_workouts/gi, 'завершённых тренировок')
    .replace(/session_count/gi, 'число наблюдений')
    .replace(/first_session/gi, 'первый результат')
    .replace(/last_session/gi, 'последний результат')
    .replace(/change_percent/gi, 'изменение')
    .replace(/pace_min_per_km/gi, 'темп')
    .replace(/\bworkouts?\b/gi, 'тренировки')
    .replace(/\bactive\s+weeks?\b/gi, 'активные недели')
    .replace(/\blongest\s+gap\b/gi, 'максимальный перерыв')
    .replace(/\bpace\b/gi, 'темп')
    .replace(/\bdistance\b/gi, 'дистанция')
    .replace(/\bvolume\b/gi, 'объём')
    .replace(/\bweight\b/gi, 'вес')
    .replace(/\breps?\b/gi, 'повторения')
    .replace(/\b[a-z]+_[a-z_]+\b/gi, 'показатель')
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
    .replace(/(?<![\d.,])-?\d+[.,]\d{2,}(?![.,]\d)/g, (raw) => {
      const parsed = numeric(raw)
      return Number.isFinite(parsed) ? oneDecimal.format(parsed) : raw
    })
}
