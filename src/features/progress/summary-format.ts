const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

function numeric(value: string): number {
  return Number(value.replace(',', '.'))
}

export function formatWorkoutsPerWeek(value: number): string {
  return oneDecimal.format(value)
}

export function formatSummaryText(value: string): string {
  return value
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
