import { expect, it, vi } from 'vitest'
import { probeNutritionSearch } from './nutrition-search-probe.js'

it('probes only ten public searches without actor/database access or credential output', async () => {
  // Fresh response bodies for each independent external request.
  const request = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ result: { content: [{ type: 'text',
    text: JSON.stringify({ ok: true, data: { items: [{ id: 1, name: 'Салат "Оливье"', properties: [
      { name: 'Пищевая и энергетическая ценность в 100 г', value: '117 ккал' },
    ] }, { id: 2, name: 'Сыр Пармезан', properties: [
      { name: 'Пищевая и энергетическая ценность в 100 г', value: '356 ккал' },
    ] }], meta: { has_more: false } } }),
  }] } }))))
  const report = await probeNutritionSearch(undefined, request)
  expect(report.ready).toBe(true)
  expect(report.perekConfigured).toBe(false)
  expect(report.cases.map(item => item.query)).toEqual(['йогурт', 'йогурт натуральный', 'оливье', 'салат оливье', 'сыр', 'сыр пар', 'огурец', 'перец', 'яблоко', 'мандарин'])
  expect(request).toHaveBeenCalledTimes(10)
  expect(request.mock.calls.every(([url]) => url === 'https://mcp.vkusvill.ru/mcp')).toBe(true)
})

it('reports failures with fixed statuses and never serializes a key or upstream error', async () => {
  const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic-private-key upstream body'))
  const report = await probeNutritionSearch('synthetic-private-key', request)
  expect(report.ready).toBe(false)
  expect(report.cases.map(item => item.status)).toEqual(['found', 'found', 'unavailable', 'unavailable', 'unavailable', 'unavailable', 'found', 'found', 'found', 'found'])
  expect(JSON.stringify(report)).not.toMatch(/synthetic-private-key|upstream body/)
})
