import { describe, expect, it } from 'vitest'
import { chatDayKey, chatDayLabel, chatListTimeLabel } from './chat-dates'

const now = new Date(2026, 9, 28, 9, 11)
const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month, day, hour, minute).toISOString()

describe('chat dates', () => {
  it('labels a conversation day relative to the phone day', () => {
    expect(chatDayLabel(at(2026, 9, 28, 0, 5), now)).toBe('Сегодня')
    expect(chatDayLabel(at(2026, 9, 27, 23, 59), now)).toBe('Вчера')
    expect(chatDayLabel(at(2026, 9, 26), now)).toBe('26 октября')
    expect(chatDayLabel(at(2025, 2, 12), now)).toBe('12 марта 2025')
  })

  it('shortens the last message date in the chat list', () => {
    expect(chatListTimeLabel(at(2026, 9, 28, 8, 57), now)).toBe('08:57')
    expect(chatListTimeLabel(at(2026, 9, 27), now)).toBe('Вчера')
    expect(chatListTimeLabel(at(2026, 9, 24), now)).toBe('24 окт')
    expect(chatListTimeLabel(at(2025, 2, 12), now)).toBe('12.03.2025')
  })

  it('treats messages of one local day as one group', () => {
    expect(chatDayKey(at(2026, 9, 27, 0, 1))).toBe(chatDayKey(at(2026, 9, 27, 23, 59)))
    expect(chatDayKey(at(2026, 9, 27, 23, 59))).not.toBe(chatDayKey(at(2026, 9, 28, 0, 1)))
  })
})
