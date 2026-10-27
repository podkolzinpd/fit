import { describe, expect, it, vi } from 'vitest'
import { BasicNutritionCatalog, createNutritionCatalog, FallbackNutritionCatalog, isEanBarcode, isRelevantCatalogSearch, parseCatalogFood, parseCatalogFoods, parseOpenFoodFactsBarcode, parsePerekFood, PerekNutritionCatalog, publicNutritionFood, VkusvillNutritionCatalog, NutritionCatalogUnavailableError, type CatalogFood, type NutritionCatalog } from './nutrition-catalog.js'
import { USDA_RAW_PRODUCE, USDA_RAW_PRODUCE_SOURCE } from './nutrition-raw-produce.data.js'

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
  it('rejects a wrong nutrition basis and unreviewed Latin names, but accepts quoted dishes', () => {
    const wrong = fixture(verifiedValues)
    wrong.properties[0]!.name = 'Пищевая ценность в 100 мл'
    expect(parseCatalogFood(wrong)).toBeNull()
    expect(parseCatalogFood(fixture(verifiedValues, 'Йогурт Brand'))).toBeNull()
    expect(parseCatalogFood(fixture(verifiedValues, 'Салат «Оливье»'))).toMatchObject({ name: 'Салат «Оливье»' })
  })
  it('keeps explicitly labelled producer recipes separate and stable without averaging', () => {
    const product = fixture('ООО "ГЛОБАЛ ФУД": белки 5.9 г, жиры 10.5 г, углеводы 6.1 г; 142.5 ккал<br>ООО "КОРОНА-ФУД": белки 5.9 г, жиры 13.2 г, углеводы 6.4 г; 168 ккал', 'Салат "Оливье" с колбасой')
    const foods = parseCatalogFoods(product)
    expect(foods).toMatchObject([
      { name: 'Салат "Оливье" с колбасой — ГЛОБАЛ ФУД', calories: 142.5, fat: 10.5 },
      { name: 'Салат "Оливье" с колбасой — КОРОНА-ФУД', calories: 168, fat: 13.2 },
    ])
    expect(foods[0]?.id).not.toBe(foods[1]?.id)
    expect(parseCatalogFoods(product)).toEqual(foods)
    expect(parseCatalogFood(product)).toBeNull()
    expect(parseCatalogFoods(fixture('белки 1 г; 5 ккал<br>белки 2 г; 10 ккал'))).toEqual([])
    expect(parseCatalogFoods(fixture('ООО "А": белки 1 г; 5 ккал<br>без подписи: 10 ккал'))).toEqual([])
    expect(parseCatalogFoods(fixture('ООО "А": белки 1 г; 5 ккал<br>ООО "Б": белки 101 г; 10 ккал'))).toEqual([])
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
  it('does not return loosely associated retailer goods as a food match', async () => {
    const call = vi.fn<typeof fetch>().mockResolvedValue(response({ items: [
      fixture(verifiedValues, 'Зефир на сиропе топинамбура в молочном шоколаде'),
      fixture(verifiedValues, 'Глазунья из двух яиц'),
    ] }))
    await expect(new VkusvillNutritionCatalog(call).search('глазунья', 1)).resolves.toMatchObject({ foods: [{ name: 'Глазунья из двух яиц' }] })
    expect(isRelevantCatalogSearch('яичница', 'Оладьи на кефире')).toBe(false)
    expect(isRelevantCatalogSearch('куриная грудка', 'Филе куриной грудки')).toBe(true)
    expect(isRelevantCatalogSearch('оливье', 'Салат "Оливье" с колбасой')).toBe(true)
    expect(isRelevantCatalogSearch('натуральный йогурт', 'Йогурт натуральный')).toBe(true)
    expect(isRelevantCatalogSearch('йогурт натуральный', 'Йогурт клубничный')).toBe(false)
    expect(isRelevantCatalogSearch('йогурт 2%', 'Йогурт натуральный 3,25%')).toBe(false)
    expect(isRelevantCatalogSearch('йогу', 'Йогурт натуральный')).toBe(true)
  })
  it('offers quoted Olivier and producer variants on the first result page and honors upstream pagination', async () => {
    const call = vi.fn<typeof fetch>().mockResolvedValue(response({ meta: { has_more: false }, items: [
      fixture('117 ккал; белки 3 г, жиры 7 г, углеводы 10 г', 'Салат "Оливье вегетарианский"'),
      fixture('ООО "А": 142.5 ккал; белки 5.9 г, жиры 10.5 г, углеводы 6.1 г<br>ООО "Б": 168 ккал; белки 5.9 г, жиры 13.2 г, углеводы 6.4 г', 'Салат "Оливье" с колбасой'),
    ] }))
    const result = await new VkusvillNutritionCatalog(call).search('оливье', 1)
    expect(result.foods.map(food => food.calories)).toEqual([117, 142.5, 168])
    expect(result.hasMore).toBe(false)
    call.mockResolvedValue(response({ meta: { has_more: true }, items: [] }))
    expect(await new VkusvillNutritionCatalog(call).search('оливье', 2)).toEqual({ foods: [], hasMore: true })
  })
  it.each([new Response('private upstream body', { status: 429 }), new Response('{}'), new Response('<html>')])(
    'reports source errors safely, never as empty results', async (upstream) => {
      const call = vi.fn<typeof fetch>().mockResolvedValue(upstream)
      await expect(new VkusvillNutritionCatalog(call).search('курица', 1)).rejects.toThrow(NutritionCatalogUnavailableError)
    },
  )
})

describe('Perek API source', () => {
  const perek = { id: 'burger-king/vopper', name: 'Воппер', url: 'https://perek.us/food/burger-king/vopper', brand: { name: 'Бургер Кинг' }, servings: [{ label: 'Порция', grams: 274 }], per100: {
    kcal: 262.77, protein: 9.85, fat: 16.06, carbs: 19.34,
  } }

  it('uses the documented server-side search, country filter and manufacturer', async () => {
    const call = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ foods: [perek], more: false })))
    const catalog = new PerekNutritionCatalog('pk_test_key', call)
    const result = await catalog.search('воппер', 2)
    expect(call).toHaveBeenCalledTimes(1)
    const [url, options] = call.mock.calls[0]!
    expect(url).toBe('https://perek.us/api/v1/foods/search?q=%D0%B2%D0%BE%D0%BF%D0%BF%D0%B5%D1%80&limit=10&offset=10&market=ru&full=true')
    expect(options?.headers).toMatchObject({ 'x-api-key': 'pk_test_key' })
    expect(result).toMatchObject({ foods: [{ name: 'Воппер', manufacturer: 'Бургер Кинг', servings: [{ label: 'Порция', grams: 274 }] }], hasMore: false })
    expect(publicNutritionFood(result.foods[0]!)).toMatchObject({ manufacturer: 'Бургер Кинг', servings: [{ label: 'Порция', grams: 274 }] })
  })

  it('rejects products without a safe product link or bounded nutrition', () => {
    expect(parsePerekFood({ ...perek, url: 'https://not-perek.example/food/a' })).toBeNull()
    expect(parsePerekFood({ ...perek, per100: { ...perek.per100, protein: 150 } })).toBeNull()
  })
  it('keeps multiword matches in any order and brand searches, but lets unrelated similar foods fall back', async () => {
    const call = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      foods: [{ ...perek, name: 'Натуральный йогурт' }, perek], more: true,
    }))))
    const catalog = new PerekNutritionCatalog('pk_test_key', call)
    expect((await catalog.search('йогурт натуральный', 1)).foods.map(food => food.name)).toEqual(['Натуральный йогурт'])
    expect((await catalog.search('бургер кинг', 1)).foods).toHaveLength(2)
    expect(await catalog.search('салат оливье', 1)).toEqual({ foods: [], hasMore: true })
  })
})

describe('reviewed basic foods', () => {
  it('keeps the complete pinned raw produce slice with traceable, finite per100g values', () => {
    expect(USDA_RAW_PRODUCE).toHaveLength(96)
    expect(new Set(USDA_RAW_PRODUCE.map(food => food.sourceId)).size).toBe(96)
    expect(USDA_RAW_PRODUCE_SOURCE).toMatchObject({ basis: '100g', dataType: 'Survey (FNDDS)',
      nutrientIds: { calories: 1008, protein: 1003, fat: 1004, carbs: 1005 } })
    for (const food of USDA_RAW_PRODUCE) {
      expect(food.sourceDescription).toMatch(/, raw$/i)
      expect(String(food.foodCode)).toMatch(/^[67]/)
      expect(food.name).toMatch(/[а-я]/i)
      expect(food.name.length).toBeLessThanOrEqual(160)
      for (const key of ['protein', 'fat', 'carbs'] as const) {
        expect(Number.isFinite(food[key])).toBe(true)
        expect(food[key]).toBeGreaterThanOrEqual(0)
        expect(food[key]).toBeLessThanOrEqual(100)
      }
      expect(food.protein + food.fat + food.carbs).toBeLessThanOrEqual(101)
      expect(food.calories).toBeGreaterThanOrEqual(0)
      expect(food.calories).toBeLessThanOrEqual(1000)
    }
  })
  it.each([
    ['огурец', 'Огурец, свежий', 2709784, 16],
    ['перец', 'Перец сладкий зелёный, свежий', 2709800, 23],
    ['яблоко', 'Яблоко, свежее', 2709215, 61],
    ['мандарин', 'Мандарин, свежий', 2709175, 53],
    ['авокадо', 'Авокадо, свежее', 2709223, 160],
    ['клубника', 'Клубника, свежая', 2709283, 36],
    ['арбуз', 'Арбуз, свежий', 2709270, 30],
    ['морковь', 'Морковь, сырая', 2709660, 44],
  ])('finds %s with a source-backed identity even when upstream is unavailable', async (query, name, sourceId, calories) => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new NutritionCatalogUnavailableError())
    const catalog = createNutritionCatalog('synthetic-key', request)
    const result = await catalog.search(query, 1)
    const food = result.foods.find(item => item.sourceId === sourceId)
    expect(food).toMatchObject({ name, sourceId, calories, basis: '100g' })
    expect((await catalog.search(query, 1)).foods.find(item => item.sourceId === sourceId)?.id).toBe(food?.id)
    expect(await new BasicNutritionCatalog().details(sourceId)).toEqual(food)
    expect(result.hasMore).toBe(false)
  })
  it('puts the actual fruit before packaged flavor matches without substituting their recipe', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({
      ok: true, data: { items: [{ ...fixture('315.4 ккал; белки 6.1 г, жиры 13.4 г, углеводы 42.6 г', 'Круассаны-мини «Облепиха-мандарин»'), id: 120067 }], meta: { has_more: false } },
    }) }] } }))))
    const catalog = createNutritionCatalog(undefined, request)
    expect((await catalog.search('мандарин', 1)).foods.map(food => food.name)).toEqual(['Мандарин, свежий', 'Круассаны-мини «Облепиха-мандарин»'])
    expect((await catalog.search('мандарин круассаны', 1)).foods.map(food => food.calories)).toEqual([315.4])
    const basics = new BasicNutritionCatalog()
    for (const query of ['огурец маринованный', 'яблоко сушёное', 'бутерброд с маслом и сыром']) {
      expect((await basics.search(query, 1)).foods).toEqual([])
    }
  })
  it('paginates broad reference matches without repeating or losing identities', async () => {
    const catalog = new BasicNutritionCatalog(), ids: string[] = []
    for (let page = 1; page <= 20; page++) {
      const result = await catalog.search('свеж', page)
      expect(result.foods.length).toBeLessThanOrEqual(10)
      ids.push(...result.foods.map(food => food.id))
      if (!result.hasMore) break
    }
    expect(ids.length).toBeGreaterThan(10)
    expect(new Set(ids).size).toBe(ids.length)
    expect(await catalog.search('свеж', 100)).toEqual({ foods: [], hasMore: false })
  })
  it('does not mistake raw broccoli for cheese or hide retailer cheese matches', async () => {
    expect((await new BasicNutritionCatalog().search('сыр', 1)).foods).toEqual([])
    const call = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({
      ok: true, data: { items: [fixture(verifiedValues, 'Брокколи, сырая'),
        { ...fixture('356 ккал; белки 35 г, жиры 24 г, углеводы 0 г', 'Сыр Пармезан «Аргентинский»'), id: 120065 }], meta: { has_more: false } },
    }) }] } }))))
    const catalog = createNutritionCatalog(undefined, call)
    for (const query of ['сыр', 'сыр пар']) {
      expect((await catalog.search(query, 1)).foods.map(food => food.name)).toEqual(['Сыр Пармезан «Аргентинский»'])
    }
  })
  it.each(['Брокколи, сырая', 'Морковь сырая', 'Мясо сырое', 'Сыровяленая колбаса', 'Сырники'])('does not interpret the word cheese as %s', name => {
    expect(isRelevantCatalogSearch('сыр', name)).toBe(false)
  })
  it.each(['Сыр Пармезан', 'Сыр «Российский»', 'Салат, сыр и томаты'])('matches the whole short food name in %s', name => {
    expect(isRelevantCatalogSearch('сыр', name)).toBe(true)
  })
  it.each([
    ['рис', 'Рис длиннозерный', 'Рисовая мука'],
    ['мак', 'Мак пищевой', 'Макароны'],
    ['лук', 'Лук репчатый', 'Луковый соус'],
    ['чай', 'Чай черный', 'Чайный напиток'],
    ['сок', 'Сок яблочный', 'Сокосодержащий напиток'],
  ])('uses the same whole-token rule for %s without a food dictionary', (query, exact, other) => {
    expect(isRelevantCatalogSearch(query, exact)).toBe(true)
    expect(isRelevantCatalogSearch(query, other)).toBe(false)
  })
  it.each([
    ['сыр пар', 'Сыр Пармезан'], ['рис бас', 'Рис Басмати'], ['чай зел', 'Чай зеленый'],
  ])('keeps final-word autocomplete for %s', (query, name) => {
    expect(isRelevantCatalogSearch(query, name)).toBe(true)
  })
  it('supplements a broad yogurt search with the reviewed record without hiding existing varieties', async () => {
    const call = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify({
      ok: true, data: { items: [fixture('76 ккал; белки 6 г, жиры 4 г, углеводы 4 г', 'Йогурт греческий 4%')], meta: { has_more: true } },
    }) }] } }))))
    const catalog = createNutritionCatalog(undefined, call)
    const first = await catalog.search('йогурт', 1)
    expect(first.foods.map(food => food.name)).toEqual(['Йогурт натуральный 3,25%', 'Йогурт греческий 4%'])
    expect(first.hasMore).toBe(true)
    const second = await catalog.search('йогурт', 2)
    expect(second.foods.map(food => food.name)).toEqual(['Йогурт греческий 4%'])
    call.mockRejectedValue(new NutritionCatalogUnavailableError())
    expect((await catalog.search('йогурт натуральный', 1)).foods).toHaveLength(1)
    await expect(catalog.search('оливье', 1)).rejects.toThrow(NutritionCatalogUnavailableError)
  })
  it.each(['йогурт', 'йогурт натуральный', 'натуральный йогурт'])('finds the same verified whole-milk yogurt for %s', async query => {
    expect(await new BasicNutritionCatalog().search(query, 1)).toMatchObject({ foods: [{
      sourceId: 171284, name: 'Йогурт натуральный 3,25%', calories: 61, protein: 3.47, fat: 3.25, carbs: 4.66,
    }] })
  })
  it('does not replace a specific yogurt recipe with a generic natural yogurt', async () => {
    expect((await new BasicNutritionCatalog().search('йогурт клубничный', 1)).foods).toEqual([])
    expect((await new BasicNutritionCatalog().search('йогурт 2%', 1)).foods).toEqual([])
    expect((await new BasicNutritionCatalog().search('йо', 1)).foods).toEqual([])
    expect((await new BasicNutritionCatalog().search('йогу', 1)).foods.map(food => food.sourceId)).toEqual([171284])
  })
  it.each(['яичница', 'глазунья', 'жареное яйцо'])('finds the canonical fried-egg record for %s', async (query) => {
    await expect(new BasicNutritionCatalog().search(query, 1)).resolves.toMatchObject({ foods: [{
      name: 'Яичница-глазунья', calories: 196, protein: 13.61, fat: 14.84, carbs: 0.83,
      servings: [{ label: '1 яйцо', grams: 46 }],
    }] })
  })

  it('also offers the cooked egg for a broad egg search', async () => {
    await expect(new BasicNutritionCatalog().search('яйцо', 1)).resolves.toMatchObject({ foods: [{ name: 'Яичница-глазунья' }] })
  })

  it.each([
    ['бананы', 'Банан', 85, { label: '1 банан', grams: 110 }],
    ['молоко', 'Молоко 3,2%', 60, { label: '1 стакан', grams: 249 }],
    ['куриная голень', 'Куриная голень без кожи, тушёная', 156, { label: '1 голень', grams: 94.7 }],
    ['помидоры черри', 'Помидоры черри', 27, { label: '5 помидоров', grams: 49.7 }],
    ['брокколи', 'Брокколи, сырая', 31, { label: '1 чашка', grams: 76 }],
  ])('finds the reviewed Foundation food for %s', async (query, name, calories, serving) => {
    const foods = (await new BasicNutritionCatalog().search(query, 1)).foods
    expect(foods).toEqual(expect.arrayContaining([expect.objectContaining({ name, calories, servings: [serving] })]))
  })
})

describe('source fallback', () => {
  const food: CatalogFood = { id: '6c29d0c8-9350-4cbc-8a5b-123456789abc', sourceId: 1, name: 'Рис', basis: '100g', calories: 116, protein: 2.2, fat: 0.5, carbs: 24.9 }
  const catalog = (search: NutritionCatalog['search'], barcode?: NutritionCatalog['barcode']): NutritionCatalog => ({
    search,
    details: () => Promise.resolve(null),
    ...(barcode === undefined ? {} : { barcode }),
  })

  it('falls back only after a Perek miss or outage', async () => {
    const fallback = vi.fn<NutritionCatalog['search']>().mockResolvedValue({ foods: [food], hasMore: false })
    const combined = new FallbackNutritionCatalog(catalog(() => Promise.reject(new NutritionCatalogUnavailableError())), catalog(fallback))
    expect(await combined.search('рис', 1)).toEqual({ foods: [food], hasMore: false })
    expect(fallback).toHaveBeenCalledOnce()
  })
  it('tries another source after an empty filtered page and preserves remaining primary pages', async () => {
    const fallback = vi.fn<NutritionCatalog['search']>().mockResolvedValue({ foods: [food], hasMore: false })
    const combined = new FallbackNutritionCatalog(catalog(() => Promise.resolve({ foods: [], hasMore: true })), catalog(fallback))
    expect(await combined.search('рис', 1)).toEqual({ foods: [food], hasMore: true })
    expect(fallback).toHaveBeenCalledOnce()
  })
})

describe('barcode normalization', () => {
  it('accepts only valid EAN checksums and maps a bounded Open Food Facts response', () => {
    expect(isEanBarcode('5449000000996')).toBe(true)
    expect(isEanBarcode('5449000000997')).toBe(false)
    expect(parseOpenFoodFactsBarcode({ product: { product_name_ru: 'Вода', nutriments: {
      'energy-kcal_100g': 0, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0,
    } } }, '5449000000996')).toMatchObject({ name: 'Вода', calories: 0 })
  })
  it('continues to Open Food Facts when the retailer barcode tool is unavailable', async () => {
    const call = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('unsupported', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ product: { product_name_ru: 'Вода', nutriments: {
        'energy-kcal_100g': 0, proteins_100g: 0, fat_100g: 0, carbohydrates_100g: 0,
      } } })))
    await expect(new VkusvillNutritionCatalog(call).barcode('5449000000996')).resolves.toMatchObject({ name: 'Вода', calories: 0 })
    expect(call.mock.calls[1]?.[0]).toBe('https://world.openfoodfacts.org/api/v3/product/5449000000996.json')
  })
})
