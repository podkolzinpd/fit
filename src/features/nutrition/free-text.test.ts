import { expect, it } from 'vitest'
import { parseFoodText } from './free-text'

it('parses a plain-text food list with explicit grams without inventing nutrition facts', () => {
  expect(parseFoodText('куриная грудка 300гр., рис отварной 100гр')).toEqual([
    { name: 'куриная грудка', grams: 300 }, { name: 'рис отварной', grams: 100 },
  ])
})

it('keeps a food without a mass as a search phrase and rejects ambiguous oversized input', () => {
  expect(parseFoodText('омлет; яблоко 150 г')).toEqual([{ name: 'омлет', grams: null }, { name: 'яблоко', grams: 150 }])
  expect(parseFoodText('рис 20001 г')).toEqual([{ name: 'рис 20001 г', grams: null }])
  expect(parseFoodText('еда, '.repeat(13))).toEqual([])
})
