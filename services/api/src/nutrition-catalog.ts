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
}

export interface CatalogFood extends NutritionFood {
  sourceId: number
}

export interface NutritionCatalog {
  search(query: string, page: number): Promise<{ foods: CatalogFood[]; hasMore: boolean }>
  details(sourceId: number): Promise<CatalogFood | null>
  barcode?(barcode: string): Promise<CatalogFood | null>
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
  // Keep a narrow, ordinary-language catalog. Trade names need review, not
  // speculative rewriting that changes what food the nutrition describes.
  if (name.length < 2 || name.length > 160 || /[<>"«»®™]|https?:|[a-z]/i.test(name)) return null
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

export function publicNutritionFood(food: CatalogFood): NutritionFood {
  const { id, name, basis, calories, protein, fat, carbs } = food
  return { id, name, basis, calories, protein, fat, carbs }
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

export class VkusvillNutritionCatalog implements NutritionCatalog {
  constructor(private readonly fetchImplementation: typeof fetch = globalThis.fetch) {}

  private async call(name: 'vkusvill_products_search' | 'vkusvill_product_details', args: Record<string, unknown>): Promise<Record<string, unknown>> {
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
    const foods = data.items.map(parseCatalogFood).filter((food): food is CatalogFood => food !== null)
    return { foods, hasMore: data.items.length === 10 }
  }

  async details(sourceId: number) {
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) throw new NutritionCatalogUnavailableError()
    const data = await this.call('vkusvill_product_details', { id: sourceId })
    return parseCatalogFood(data)
  }

  async barcode(barcode: string) {
    if (!isEanBarcode(barcode)) throw new NutritionCatalogUnavailableError()
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
