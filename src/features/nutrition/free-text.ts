export interface ParsedFoodLine {
  name: string
  grams: number | null
}

const MAX_ITEMS = 12
const MAX_GRAMS = 20_000

function cleanName(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[\s,;—–-]+|[\s,;—–-]+$/g, '').trim()
}

/**
 * Parses only explicit mass units. It deliberately does not infer portions or
 * nutrition values: a user still chooses a matching food before it is saved.
 */
export function parseFoodText(value: string): ParsedFoodLine[] {
  if (value.length > 600) return []
  const parts = value.split(/[\n,;]+/).map(cleanName).filter(Boolean)
  if (parts.length === 0 || parts.length > MAX_ITEMS) return []
  const parsed = parts.map((part) => {
    const match = /^(.*?)(?:\s|\()?(\d+(?:[.,]\d+)?)\s*(?:г|гр|грамм(?:а|ов)?)[\s.)]*$/iu.exec(part)
    if (!match) return { name: part, grams: null }
    const name = cleanName(match[1] ?? '')
    const grams = Number((match[2] ?? '').replace(',', '.'))
    return name.length >= 2 && Number.isFinite(grams) && grams > 0 && grams <= MAX_GRAMS ? { name, grams } : { name: part, grams: null }
  }).filter((item) => item.name.length >= 2 && item.name.length <= 120)
  return parsed.length === parts.length ? parsed : []
}
