import { createHash } from 'node:crypto'

export interface NutritionValues {
  calories: number
  protein: number | null
  fat: number | null
  carbs: number | null
}

export interface NutritionFood extends NutritionValues {
  id: string
  name: string
  basis: '100g'
  manufacturer?: string
  servings?: readonly { label: string; grams: number }[]
}

export interface CatalogFood extends NutritionFood {
  sourceId: number
}

export interface NutritionCatalog {
  search(query: string, page: number): Promise<{ foods: CatalogFood[]; hasMore: boolean }>
  details(sourceId: number): Promise<CatalogFood | null>
  barcode?(barcode: string): Promise<CatalogFood | null>
}

interface BasicFood extends CatalogFood { readonly aliases: readonly string[] }

// Common cooked foods are not reliably represented by a retailer catalog or a
// barcode. Keep the small, reviewed base separate from retailer adapters so a
// user never receives a confectionery item for a dish name. Every record is a
// specific food, not a guessed average. Values are per 100 g edible portion.
// Sources: USDA FoodData Central (CC0), SR Legacy FDC 173423/171284 and Foundation
// Foods release 2026-04-30 (the corresponding FDC IDs are sourceId values).
const BASIC_FOODS: readonly BasicFood[] = [
  {
    id: '17128400-0000-4000-8000-000000000000', sourceId: 171284,
    name: 'Йогурт натуральный 3,25%', aliases: ['натуральный йогурт'], basis: '100g',
    calories: 61, protein: 3.47, fat: 3.25, carbs: 4.66,
  },
  {
    id: '17342300-0000-4000-8000-000000000000', sourceId: 173423,
    name: 'Яичница-глазунья', aliases: ['яичница', 'глазунья', 'жареное яйцо'], basis: '100g',
    calories: 196, protein: 13.61, fat: 14.84, carbs: 0.83,
    servings: [{ label: '1 яйцо', grams: 46 }],
  },
  {
    id: '11050730-0000-4000-8000-000000000000', sourceId: 1105073,
    name: 'Банан', aliases: ['бананы'], basis: '100g',
    calories: 85, protein: 0.73, fat: 0.22, carbs: 20.1,
    servings: [{ label: '1 банан', grams: 110 }],
  },
  {
    id: '74678200-0000-4000-8000-000000000000', sourceId: 746782,
    name: 'Молоко 3,2%', aliases: ['молоко', 'молоко цельное'], basis: '100g',
    calories: 60, protein: 3.27, fat: 3.2, carbs: 4.63,
    servings: [{ label: '1 стакан', grams: 249 }],
  },
  {
    id: '33189700-0000-4000-8000-000000000000', sourceId: 331897,
    name: 'Куриная голень без кожи, тушёная', aliases: ['голень куриная', 'куриная голень'], basis: '100g',
    calories: 156, protein: 23.9, fat: 5.95, carbs: 0,
    servings: [{ label: '1 голень', grams: 94.7 }],
  },
  {
    id: '32136000-0000-4000-8000-000000000000', sourceId: 321360,
    name: 'Помидоры черри', aliases: ['помидор черри', 'томаты черри'], basis: '100g',
    calories: 27, protein: 0.83, fat: 0.63, carbs: 5.51,
    servings: [{ label: '5 помидоров', grams: 49.7 }],
  },
  {
    id: '74744700-0000-4000-8000-000000000000', sourceId: 747447,
    name: 'Брокколи, сырая', aliases: ['брокколи'], basis: '100g',
    calories: 31, protein: 2.57, fat: 0.34, carbs: 6.27,
    servings: [{ label: '1 чашка', grams: 76 }],
  },
]

function normalizedFoodTerm(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export class BasicNutritionCatalog implements NutritionCatalog {
  search(query: string, page: number) {
    const normalized = normalizedFoodTerm(query)
    if (normalized.length < 2 || normalized.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 100) {
      return Promise.reject(new NutritionCatalogUnavailableError())
    }
    if (page !== 1) return Promise.resolve({ foods: [], hasMore: false })
    const foods = BASIC_FOODS.filter(food => [food.name, ...food.aliases]
      .some(term => isRelevantCatalogSearch(normalized, term)))
    return Promise.resolve({ foods, hasMore: false })
  }

  details(sourceId: number) {
    return Promise.resolve(BASIC_FOODS.find(food => food.sourceId === sourceId) ?? null)
  }
}

export class NutritionCatalogUnavailableError extends Error {
  constructor() {
    super('Food search is temporarily unavailable')
    this.name = 'NutritionCatalogUnavailableError'
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

function readNutrient(text: string, pattern: RegExp, max: number): number | null | undefined {
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) return null
  // Even identical repeated values are not assumed to describe one recipe.
  if (matches.length !== 1) return undefined
  const number = Number(matches[0]?.[1]?.replace(',', '.'))
  return Number.isFinite(number) && number >= 0 && number <= max ? number : undefined
}

export function parseCatalogFood(value: unknown): CatalogFood | null {
  const product = object(value)
  if (product === undefined || !Number.isSafeInteger(product.id)
    || typeof product.id !== 'number' || product.id <= 0
    || typeof product.name !== 'string' || !Array.isArray(product.properties)) return null
  const name = plainText(product.name).replace(/вкус\s*вилл|яндекс\s*лавка|лавка/gi, '')
    .replace(/\s+/g, ' ').replace(/^[\s,;—-]+|[\s,;—-]+$/g, '').trim()
  // Quotation marks are ordinary punctuation in dish names, not a reason to
  // discard a valid recipe. Keep rejecting markup, URLs and unreviewed names.
  if (name.length < 2 || name.length > 160 || /[<>®™]|https?:|[a-z]/i.test(name)) return null
  const nutrition = product.properties.map(object).filter((property) =>
    typeof property?.name === 'string'
    && /пищевая.*ценность.*\b100\s*г(?:\s|$)/i.test(property.name),
  )
  if (nutrition.length !== 1 || typeof nutrition[0]?.value !== 'string') return null
  const text = plainText(nutrition[0].value)
  if (/(?:белк[иа]|жир[ыа]|углевод[ыа])\s*[:—]?\s*-\s*\d/i.test(text)) return null
  const calories = readNutrient(text, /(?<![\d.,-])([\d]+(?:[.,]\d+)?)\s*ккал/gi, 1000)
  const protein = readNutrient(text, /белк[иа]\s*[:—]?\s*([\d]+(?:[.,]\d+)?)\s*г(?=\s|[,;.]|$)/gi, 100)
  const fat = readNutrient(text, /жир[ыа]\s*[:—]?\s*([\d]+(?:[.,]\d+)?)\s*г(?=\s|[,;.]|$)/gi, 100)
  const carbs = readNutrient(text, /углевод[ыа]\s*[:—]?\s*([\d]+(?:[.,]\d+)?)\s*г(?=\s|[,;.]|$)/gi, 100)
  if (calories === null || calories === undefined || protein === undefined
    || fat === undefined || carbs === undefined) return null
  if ((protein ?? 0) + (fat ?? 0) + (carbs ?? 0) > 101) return null
  const hex = createHash('sha256').update(JSON.stringify([
    'fit-food:vkusvill', product.id, name, calories, protein, fat, carbs,
  ])).digest('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  return { id, sourceId: product.id, name, basis: '100g', calories, protein, fat, carbs }
}

/** Search may offer explicitly labelled recipes separately; barcode/details
 * still refuse ambiguous nutrition instead of choosing a producer at random. */
export function parseCatalogFoods(value: unknown): CatalogFood[] {
  const single = parseCatalogFood(value)
  if (single !== null) return [single]
  const product = object(value)
  if (product === undefined || typeof product.name !== 'string' || !Array.isArray(product.properties)) return []
  const productName = product.name
  const nutrition = product.properties.map(object).filter(property => typeof property?.name === 'string'
    && /пищевая.*ценность.*\b100\s*г(?:\s|$)/i.test(property.name))
  if (nutrition.length !== 1 || typeof nutrition[0]?.value !== 'string') return []
  const lines = nutrition[0].value.split(/<br\s*\/?\s*>/i).map(plainText).filter(Boolean)
  if (lines.length < 2 || lines.length > 12) return []
  const foods = lines.map(line => {
    const match = /^((?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s+[^:]{1,100}):\s*(.+)$/u.exec(line)
    if (match === null) return null
    const manufacturer = match[1]!.replace(/^(?:ООО|АО|ПАО|ЗАО|ОАО|ИП)\s+/u, '').replace(/^["«]|["»]$/g, '').trim()
    if (manufacturer.length === 0) return null
    return parseCatalogFood({ ...product, name: `${productName} — ${manufacturer}`,
      properties: [{ name: nutrition[0]!.name, value: match[2] }] })
  })
  // A malformed/unlabelled line is not permission to silently select another.
  if (foods.some(food => food === null)) return []
  return [...new Map(foods.filter((food): food is CatalogFood => food !== null).map(food => [food.id, food])).values()]
}

export function publicNutritionFood(food: CatalogFood): NutritionFood {
  const { id, name, basis, calories, protein, fat, carbs, manufacturer, servings } = food
  return { id, name, basis, calories, protein, fat, carbs, ...(manufacturer === undefined ? {} : { manufacturer }), ...(servings === undefined ? {} : { servings }) }
}

export function isEanBarcode(value: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(value)) return false
  const digits = [...value].map(Number)
  const expected = (10 - digits.slice(0, -1).reduce((sum, digit, index) => sum + digit * ((digits.length - 2 - index) % 2 === 0 ? 3 : 1), 0) % 10) % 10
  return expected === digits.at(-1)
}

export function parseOpenFoodFactsBarcode(value: unknown, barcode: string): CatalogFood | null {
  if (!isEanBarcode(barcode)) return null
  const root = object(value), product = object(root?.product), nutriments = object(product?.nutriments)
  const rawName = typeof product?.product_name_ru === 'string' ? product.product_name_ru : product?.product_name
  const name = typeof rawName === 'string' ? plainText(rawName) : ''
  const read = (key: string, max: number) => typeof nutriments?.[key] === 'number' && Number.isFinite(nutriments[key]) && nutriments[key] >= 0 && nutriments[key] <= max ? nutriments[key] : null
  const calories = read('energy-kcal_100g', 1000)
  if (name.length < 2 || name.length > 160 || calories === null) return null
  const protein = read('proteins_100g', 100), fat = read('fat_100g', 100), carbs = read('carbohydrates_100g', 100)
  if ((protein ?? 0) + (fat ?? 0) + (carbs ?? 0) > 101) return null
  const hex = createHash('sha256').update(JSON.stringify(['fit-food:openfoodfacts', barcode, name, calories, protein, fat, carbs])).digest('hex')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  return { id, sourceId: Number.parseInt(hex.slice(0, 13), 16), name, basis: '100g', calories, protein, fat, carbs }
}

function stableCatalogId(namespace: string, sourceId: string, name: string, calories: number, protein: number | null, fat: number | null, carbs: number | null): { id: string; numericId: number } {
  const hex = createHash('sha256').update(JSON.stringify([namespace, sourceId, name, calories, protein, fat, carbs])).digest('hex')
  return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    numericId: Number.parseInt(hex.slice(0, 12), 16) }
}

function foodWords(value: string): string[] {
  return value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * The retailer endpoint sometimes returns loosely-associated goods (for
 * example, confectionery for "глазунья"). It is useful as a coverage
 * fallback, but it must never masquerade as an exact food match.
 */
export function isRelevantCatalogSearch(query: string, foodName: string): boolean {
  const queryWords = foodWords(query).filter(word => /^\d+$/.test(word)
    || (word.length >= 2 && !['из', 'на', 'со', 'по', 'от'].includes(word)))
  if (queryWords.length === 0) return true
  const nameWords = foodWords(foodName)
  const stem = (word: string) => word.slice(0, Math.min(word.length, 5))
  return queryWords.every((word, index) => nameWords.some(candidate => {
    if (/^\d+$/.test(word)) return candidate === word
    // Short standalone words must match a whole token: otherwise unrelated
    // foods share the same prefix. A final token in a phrase can still be
    // unfinished ("сыр пар"); longer tokens retain the existing stem search.
    const unfinishedLastWord = queryWords.length > 1 && index === queryWords.length - 1
    return word.length < 4 && !unfinishedLastWord
      ? candidate === word : candidate.startsWith(stem(word))
  }))
}

export function parsePerekFood(value: unknown): CatalogFood | null {
  const product = object(value), per100 = object(product?.per100)
  const sourceId = typeof product?.id === 'string' ? product.id : ''
  const rawName = typeof product?.name === 'string' ? product.name : ''
  const url = typeof product?.url === 'string' ? product.url : ''
  const name = plainText(rawName)
  const urlValid = /^https:\/\/perek\.us\/food\/[a-z0-9/-]+$/i.test(url)
  const read = (key: string, max: number): number | null | undefined => {
    if (per100?.[key] === undefined || per100?.[key] === null) return null
    const number = per100[key]
    return typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= max ? number : undefined
  }
  const calories = read('kcal', 1000)
  if (!/^[a-z0-9][a-z0-9/-]{0,180}$/i.test(sourceId) || name.length < 2 || name.length > 160 || !urlValid || calories === null || calories === undefined) return null
  const protein = read('protein', 100), fat = read('fat', 100), carbs = read('carbs', 100)
  if (protein === undefined || fat === undefined || carbs === undefined || (protein ?? 0) + (fat ?? 0) + (carbs ?? 0) > 101) return null
  const stable = stableCatalogId('fit-food:perek', sourceId, name, calories, protein, fat, carbs)
  const servings = Array.isArray(product?.servings) ? product.servings.map(object).flatMap(serving => typeof serving?.label === 'string' && typeof serving.grams === 'number' && Number.isFinite(serving.grams) && serving.grams > 0 && serving.grams <= 20_000 ? [{ label: plainText(serving.label), grams: serving.grams }] : []).filter(serving => serving.label.length > 0 && serving.label.length <= 80).slice(0, 8) : []
  const brand = object(product?.brand)
  const explicitManufacturer = typeof brand?.name === 'string' ? plainText(brand.name) : ''
  const manufacturerSlug = new URL(url).pathname.split('/').filter(Boolean).at(1)
  const manufacturer = explicitManufacturer.length > 0 && explicitManufacturer.length <= 80 ? explicitManufacturer
    : manufacturerSlug === undefined ? undefined : manufacturerSlug.split('-').map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ')
  return { id: stable.id, sourceId: stable.numericId, name, basis: '100g', calories, protein, fat, carbs,
    ...(manufacturer === undefined ? {} : { manufacturer }), ...(servings.length === 0 ? {} : { servings }) }
}

export class PerekNutritionCatalog implements NutritionCatalog {
  constructor(private readonly apiKey: string, private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  private async request(path: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.fetchImplementation(`https://perek.us/api/v1/foods${path}`, {
        headers: { accept: 'application/json', 'user-agent': 'FitNutrition/1.0 (food diary)', 'x-api-key': this.apiKey },
        redirect: 'error', signal: AbortSignal.timeout(5_000),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new NutritionCatalogUnavailableError()
      const payload = object(await response.json())
      if (payload === undefined) throw new NutritionCatalogUnavailableError()
      return payload
    } catch (error) {
      if (error instanceof NutritionCatalogUnavailableError) throw error
      throw new NutritionCatalogUnavailableError()
    }
  }

  async search(query: string, page: number) {
    if (query.trim().length < 2 || query.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 100) throw new NutritionCatalogUnavailableError()
    const params = new URLSearchParams({ q: query.trim(), limit: '10', offset: String((page - 1) * 10), market: 'ru', full: 'true' })
    const payload = await this.request(`/search?${params.toString()}`)
    if (payload === null || !Array.isArray(payload.foods) || typeof payload.more !== 'boolean') throw new NutritionCatalogUnavailableError()
    return { foods: payload.foods.map(parsePerekFood).filter((food): food is CatalogFood => food !== null
      && isRelevantCatalogSearch(query, `${food.name} ${food.manufacturer ?? ''}`)), hasMore: payload.more }
  }

  details(sourceId: number) {
    // Perek IDs are opaque strings. The diary only needs a snapshot returned by
    // search or barcode, so numeric cache IDs deliberately cannot be reversed.
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) throw new NutritionCatalogUnavailableError()
    return Promise.resolve(null)
  }

  async barcode(barcode: string) {
    if (!isEanBarcode(barcode)) throw new NutritionCatalogUnavailableError()
    const payload = await this.request(`/barcode/${barcode}`)
    if (payload === null) return null
    const food = parsePerekFood(payload.food ?? payload)
    if (food === null) throw new NutritionCatalogUnavailableError()
    return food
  }
}

export class VkusvillNutritionCatalog implements NutritionCatalog {
  constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  private async call(name: 'vkusvill_products_search' | 'vkusvill_product_details' | 'vkusvill_product_barcode', args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchImplementation('https://mcp.vkusvill.ru/mcp', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      })
      if (!response.ok) throw new NutritionCatalogUnavailableError()
      const reader = response.body?.getReader()
      if (reader === undefined) throw new NutritionCatalogUnavailableError()
      let size = 0
      const chunks: Uint8Array[] = []
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > 512_000) {
          await reader.cancel()
          throw new NutritionCatalogUnavailableError()
        }
        chunks.push(part.value)
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      const events = raw.split(/\r?\n\r?\n/).flatMap((event) => {
        const lines = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        return lines.length === 0 ? [] : [lines.map((line) => line.slice(5).trimStart()).join('\n')]
      })
      const envelope = object(JSON.parse(events.length === 0 ? raw : events[events.length - 1] ?? ''))
      const result = object(envelope?.result)
      if (result?.isError === true || !Array.isArray(result?.content)) throw new NutritionCatalogUnavailableError()
      const blocks = result.content.map(object).filter((block) => block?.type === 'text')
      if (blocks.length !== 1 || typeof blocks[0]?.text !== 'string') throw new NutritionCatalogUnavailableError()
      const payload = object(JSON.parse(blocks[0].text))
      const data = object(payload?.data)
      if (payload?.ok !== true || data === undefined) throw new NutritionCatalogUnavailableError()
      return data
    } catch {
      // Never expose upstream bodies, HTML, credentials or retail metadata.
      throw new NutritionCatalogUnavailableError()
    }
  }

  async search(query: string, page: number) {
    if (query.trim().length < 2 || query.length > 120 || !Number.isSafeInteger(page) || page < 1 || page > 100) {
      throw new NutritionCatalogUnavailableError()
    }
    const data = await this.call('vkusvill_products_search', {
      q: query.trim(), page, limit: 10, vvonly: 1,
      mode: 'custom', fields: ['id', 'name', 'properties'],
    })
    if (!Array.isArray(data.items)) throw new NutritionCatalogUnavailableError()
    const foods = data.items.flatMap(parseCatalogFoods).filter(food => isRelevantCatalogSearch(query, food.name))
    const meta = object(data.meta)
    return { foods, hasMore: typeof meta?.has_more === 'boolean' ? meta.has_more : data.items.length === 10 }
  }

  async details(sourceId: number) {
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) throw new NutritionCatalogUnavailableError()
    const data = await this.call('vkusvill_product_details', { id: sourceId })
    return parseCatalogFood(data)
  }

  async barcode(barcode: string) {
    if (!isEanBarcode(barcode)) throw new NutritionCatalogUnavailableError()
    try {
      const local = await this.call('vkusvill_product_barcode', { barcode })
      const food = parseCatalogFood(local)
      if (food !== null) return food
    } catch {
      // Barcode coverage in the retailer source is optional. A missing MCP
      // tool or an upstream error must not prevent the public fallback.
    }
    try {
      const response = await this.fetchImplementation(`https://world.openfoodfacts.org/api/v3/product/${barcode}.json`, {
        headers: { accept: 'application/json', 'user-agent': 'FitNutrition/1.0 (barcode lookup)' }, redirect: 'error', signal: AbortSignal.timeout(5_000),
      })
      if (response.status === 404) return null
      if (!response.ok) throw new NutritionCatalogUnavailableError()
      return parseOpenFoodFactsBarcode(await response.json(), barcode)
    } catch (error) {
      if (error instanceof NutritionCatalogUnavailableError) throw error
      throw new NutritionCatalogUnavailableError()
    }
  }
}

export class FallbackNutritionCatalog implements NutritionCatalog {
  constructor(private readonly primary: NutritionCatalog | undefined, private readonly fallback: NutritionCatalog,
    private readonly includeFallbackMatches = false) {}

  async search(query: string, page: number) {
    let primaryHasMore = false
    let primaryFoods: CatalogFood[] = []
    if (this.primary !== undefined) {
      try {
        const result = await this.primary.search(query, page)
        if (result.foods.length > 0 && !this.includeFallbackMatches) return result
        primaryFoods = result.foods
        primaryHasMore = result.hasMore
      } catch {
        // The pilot still has the existing source when perek.us is rate-limited
        // or temporarily unavailable.
      }
    }
    try {
      const result = await this.fallback.search(query, page)
      return { foods: [...new Map([...primaryFoods, ...result.foods].map(food => [food.id, food])).values()],
        hasMore: primaryHasMore || result.hasMore }
    } catch (error) {
      if (primaryFoods.length > 0) return { foods: primaryFoods, hasMore: primaryHasMore }
      throw error
    }
  }

  details(sourceId: number) { return this.fallback.details(sourceId) }

  async barcode(barcode: string) {
    if (this.primary?.barcode !== undefined) {
      try {
        const food = await this.primary.barcode(barcode)
        if (food !== null) return food
      } catch {
        // A provider failure is not a barcode miss; try the existing fallback.
      }
    }
    return this.fallback.barcode?.(barcode) ?? null
  }
}

/** Reviewed basics supplement broad searches instead of hiding branded foods.
 * Runtime and the read-only production probe use the same composition. */
export function createNutritionCatalog(apiKey?: string, request: typeof fetch = globalThis.fetch): NutritionCatalog {
  return new FallbackNutritionCatalog(new BasicNutritionCatalog(),
    new FallbackNutritionCatalog(apiKey ? new PerekNutritionCatalog(apiKey, request) : undefined,
      new VkusvillNutritionCatalog(request)), true)
}
