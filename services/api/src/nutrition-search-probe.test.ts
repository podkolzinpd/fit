import { expect, it, vi } from 'vitest'
import { probeNutritionSearch } from './nutrition-search-probe.js'

it('probes only four public searches without actor/database access or credential output', async () => {
  // Fresh response bodies for the two independent external requests.
  const request = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ result: { content: [{ type: 'text',
    text: JSON.stringify({ ok: true, data: { items: [{ id: 1, name: 'Салат "Оливье"', properties: [
      { name: 'Пищевая и энергетическая ценность в 100 г', value: '117 ккал' },
    ] }], meta: { has_more: false } } }),
  }] } }))))
  const report = await probeNutritionSearch(undefined, request)
  expect(report.ready).toBe(true)
  expect(report.perekConfigured).toBe(false)
  expect(report.cases.map(item => item.query)).toEqual(['йогурт', 'йогурт натуральный', 'оливье', 'салат оливье'])
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.every(([url]) => url === 'https://mcp.vkusvill.ru/mcp')).toBe(true)
})

it('reports failures with fixed statuses and never serializes a key or upstream error', async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-private-key upstream body'))
  const report = await probeNutritionSearch('synthetic-private-key', request)
  expect(report.ready).toBe(false)
  expect(report.cases.map(item => item.status)).toEqual(['found', 'found', 'unavailable', 'unavailable'])
  expect(JSON.stringify(report)).not.toMatch(/synthetic-private-key|upstream body/)
})
