import { pathToFileURL } from 'node:url'
import { BasicNutritionCatalog, FallbackNutritionCatalog, PerekNutritionCatalog, VkusvillNutritionCatalog, publicNutritionFood, isRelevantCatalogSearch } from './nutrition-catalog.js'

// No actor sessions or database queries: only the public catalog contract.
export async function probeNutritionSearch(apiKey: string | undefined, request: typeof fetch = globalThis.fetch) {
  const retailer = new VkusvillNutritionCatalog(request)
  const catalog = new FallbackNutritionCatalog(new BasicNutritionCatalog(),
    new FallbackNutritionCatalog(apiKey ? new PerekNutritionCatalog(apiKey, request) : undefined, retailer))
  const cases = []
  for (const query of ['йогурт', 'йогурт натуральный', 'оливье', 'салат оливье']) {
    try {
      const result = await catalog.search(query, 1)
      cases.push({ query, status: result.foods.some(food => isRelevantCatalogSearch(query, food.name)) ? 'found' : 'empty', count: result.foods.length,
        foods: result.foods.slice(0, 3).map(publicNutritionFood), hasMore: result.hasMore })
    } catch {
      // Never log an upstream body, key, env, driver message or private identity.
      cases.push({ query, status: 'unavailable', count: 0, foods: [], hasMore: false })
    }
  }
  return { event: 'nutrition_search_probe', perekConfigured: Boolean(apiKey),
    ready: cases.every(item => item.status === 'found'), cases }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await probeNutritionSearch(process.env.NUTRITION_PEREK_API_KEY)
  console.log(JSON.stringify(report))
  if (!report.ready) process.exitCode = 1
}
