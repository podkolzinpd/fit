import { describe, expect, it, vi } from 'vitest'
import { parseCatalogFood, publicNutritionFood, VkusvillNutritionCatalog, NutritionCatalogUnavailableError } from './nutrition-catalog.js'

const fixture = (value: string, name = 'Курица в сливочно-шпинатном соусе с рисом') => ({
  id: 120063, name, properties: [{ name: 'Пищевая и энергетическая ценность в 100 г', value }],
})
const verifiedValues = 'белки 9.8 г, жиры 4.2 г, углеводы 18.8 г,, в том числе сахара (общие) - 1 г, соль - 1.2 г; 152.2 ккал'

describe('food catalog normalization', () => {
  it('reads the verified 100g example without any retail fields', () => {
    const food = parseCatalogFood({ ...fixture(verifiedValues), price: 320, url: 'https://example.invalid', weight: 0.25 })
    expect(food).toMatchObject({ calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8, basis: '100g' })
    expect(food).not.toBeNull()
    if (food !== null) {
      expect(publicNutritionFood(food)).not.toHaveProperty('sourceId')
      expect(Object.keys(publicNutritionFood(food)).sort()).toEqual(['basis', 'calories', 'carbs', 'fat', 'id', 'name', 'protein'])
    }
  })
  it('keeps decimal commas and removes source branding', () => {
    expect(parseCatalogFood(fixture(verifiedValues.replaceAll('.', ','), 'ВкусВилл Курица с рисом')))
      .toMatchObject({ name: 'Курица с рисом', calories: 152.2 })
  })
  it('keeps unknown macros null, not zero', () => {
    expect(parseCatalogFood(fixture('0 ккал', 'Вода'))).toMatchObject({ calories: 0, protein: null, fat: null, carbs: null })
  })
  it.each([
    'белки 9.7 г, жиры 8.8 г, углеводы 19.7 г; 196.8 ккал<br>белки 10.8 г, жиры 8 г, углеводы 18.1 г; 187.6 ккал',
    'белки 1 г; 5 ккал<br>белки 1 г; 5 ккал',
    'белки 105 г; 152 ккал', '152 кДж', '-152 ккал', '1001 ккал', 'белки 60 г, жиры 60 г; 500 ккал',
  ])('rejects ambiguous or invalid nutrition: %s', (value) => {
    expect(parseCatalogFood(fixture(value))).toBeNull()
  })
  it('rejects a missing or wrong nutrition basis and trade names', () => {
    const wrong = fixture(verifiedValues)
    wrong.properties[0]!.name = 'Пищевая ценность в 100 мл'
    expect(parseCatalogFood(wrong)).toBeNull()
    expect(parseCatalogFood(fixture(verifiedValues, 'Йогурт Brand'))).toBeNull()
    expect(parseCatalogFood(fixture(verifiedValues, 'Салат «Бренд»'))).toBeNull()
  })
  it('does not merge different product identities or recipes', () => {
    const a = parseCatalogFood(fixture(verifiedValues))
    const b = parseCatalogFood({ ...fixture(verifiedValues), id: 120064 })
    expect(a?.id).not.toEqual(b?.id)
  })
})

describe('read-only public food source', () => {
  const response = (data: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, data }) }],
  } }), { headers: { 'content-type': 'application/json' } })
  it('only calls product search with minimal fields', async () => {
    const call = vi.fn<typeof fetch>().mockResolvedValue(response({ items: [fixture(verifiedValues)] }))
    const catalog = new VkusvillNutritionCatalog(call)
    expect(await catalog.search('курица', 1)).toMatchObject({ foods: [{ calories: 152.2 }], hasMore: false })
    const [url, options] = call.mock.calls[0]!
    expect(url).toBe('https://mcp.vkusvill.ru/mcp')
    expect(options?.redirect).toBe('error')
    const body = options?.body
    if (typeof body !== 'string') throw new Error('Expected JSON request body')
    expect(JSON.parse(body)).toMatchObject({ method: 'tools/call', params: {
      name: 'vkusvill_products_search', arguments: { fields: ['id', 'name', 'properties'] },
    } })
  })
  it('accepts the SSE transport envelope', async () => {
    const json = await response({ items: [fixture(verifiedValues)] }).text()
    const call = vi.fn<typeof fetch>().mockResolvedValue(new Response(`event: message\ndata: ${json}\n\n`))
    expect((await new VkusvillNutritionCatalog(call).search('курица', 1)).foods).toHaveLength(1)
  })
  it.each([new Response('private upstream body', { status: 429 }), new Response('{}'), new Response('<html>')])(
    'reports source errors safely, never as empty results', async (upstream) => {
      const call = vi.fn<typeof fetch>().mockResolvedValue(upstream)
      await expect(new VkusvillNutritionCatalog(call).search('курица', 1)).rejects.toThrow(NutritionCatalogUnavailableError)
    },
  )
})
