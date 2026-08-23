const units: Record<string, number> = {
  ноль: 0,
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  три: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
  семь: 7,
  восемь: 8,
  девять: 9,
  десять: 10,
  одиннадцать: 11,
  двенадцать: 12,
  тринадцать: 13,
  четырнадцать: 14,
  пятнадцать: 15,
  шестнадцать: 16,
  семнадцать: 17,
  восемнадцать: 18,
  девятнадцать: 19,
}

const tens: Record<string, number> = {
  двадцать: 20,
  тридцать: 30,
  сорок: 40,
  пятьдесят: 50,
  шестьдесят: 60,
  семьдесят: 70,
  восемьдесят: 80,
  девяносто: 90,
}

const hundreds: Record<string, number> = {
  сто: 100,
  двести: 200,
  триста: 300,
  четыреста: 400,
  пятьсот: 500,
  шестьсот: 600,
  семьсот: 700,
  восемьсот: 800,
  девятьсот: 900,
}

const oneToNineWords = Object.keys(units).filter((word) => units[word]! < 10).join('|')
const teenWords = Object.keys(units).filter((word) => units[word]! >= 10).join('|')
const tensWords = Object.keys(tens).join('|')
const hundredsWords = Object.keys(hundreds).join('|')
const integerWordSource = `(?:${hundredsWords})(?:\\s+(?:(?:${tensWords})(?:\\s+(?:${oneToNineWords}))?|${teenWords}|${oneToNineWords}))?|(?:${tensWords})(?:\\s+(?:${oneToNineWords}))?|${teenWords}|${oneToNineWords}`

/**
 * A bounded number expression for workout metrics. It deliberately excludes
 * inflected words such as «одной» and «двумя», because they often belong to an
 * exercise name rather than to a weight, rep or set count.
 */
export const WORKOUT_NUMBER_SOURCE = `(?:\\d+(?:[.,]\\d+)?|полтора|полторы|(?:${integerWordSource})(?:\\s+с\\s+половиной)?)`

function normalizedWords(value: string): string[] {
  return value
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N},.]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
}

/** Parse a number only after a metric grammar has identified its role. */
export function parseWorkoutNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const numeric = Number(value.replace(',', '.'))
  if (Number.isFinite(numeric)) return numeric

  const words = normalizedWords(value)
  if (!words.length) return undefined
  if (words.length === 1 && (words[0] === 'полтора' || words[0] === 'полторы')) return 1.5
  const hasHalf = words.length >= 2 && words.at(-2) === 'с' && words.at(-1) === 'половиной'
  const numberTokens = hasHalf ? words.slice(0, -2) : words
  if (!numberTokens.length) return undefined

  let result = 0
  for (const word of numberTokens) {
    const part = units[word] ?? tens[word] ?? hundreds[word]
    if (part === undefined) return undefined
    result += part
  }
  return result + (hasHalf ? 0.5 : 0)
}

// Only standalone hesitation and discourse markers are removed. Single «а» /
// «и» stay intact because they can join real exercise names.
const filler = /(^|[^\p{L}\p{N}])(?:в\s+общем(?:-то)?|как\s+бы|это\s+самое|короче|значит|поехали|ага|ну|так|вот|мэ+|бэ+|эм+|мм+|э+|а{2,})(?=$|[^\p{L}\p{N}])/giu

/**
 * Clean only the internal parsing copy. The UI continues to own and preserve
 * the original transcript until a fully structured result is confirmed.
 */
export function normalizeWorkoutSpeech(value: string): string {
  return value
    .split('\n')
    .map((line) => line
      .replace(filler, '$1')
      .replace(filler, '$1')
      .replace(/(^|[^\p{L}\p{N}])([\p{L}]{3,})(?:\s+\2)+(?=$|[^\p{L}\p{N}])/giu, '$1$2')
      .replace(/(?:\s*[,.;:!?—-]\s*){2,}/g, ', ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/^[\s,.;:!?—-]+|[\s,.;:!?—-]+$/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
}
