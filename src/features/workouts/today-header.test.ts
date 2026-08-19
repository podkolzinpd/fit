import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayHeaderProps } from './today-header'
import type { SessionActor } from '../../shared/domain'

const trainer = { role: 'trainer', userId: 'trainer-user' } as SessionActor
const client = { role: 'client', userId: 'client-user' } as SessionActor

afterEach(() => vi.unstubAllEnvs())

describe('todayHeaderProps: шапка «Сегодня»/«Ассистент» (пилот YAFIT-317)', () => {
  it('вне пилота тренер видит «Сегодня» с аватаром профиля', () => {
    expect(todayHeaderProps(false, trainer)).toEqual({ title: 'Сегодня', hideTitle: false, showProfileAvatar: true })
  })

  it('тренер из allowlist получает sr-only «Ассистент» без аватара', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-user')
    expect(todayHeaderProps(false, trainer)).toEqual({ title: 'Ассистент', hideTitle: true, showProfileAvatar: false })
  })

  it('клиент из allowlist сохраняет прежнюю шапку — пилот тренерский', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'client-user')
    expect(todayHeaderProps(true, client)).toEqual({ title: 'Сегодня', hideTitle: false, showProfileAvatar: true })
  })

  it('actor=null безопасен и остаётся вне пилота', () => {
    vi.stubEnv('VITE_ASSISTANT_NAV_ENABLED', 'true')
    vi.stubEnv('VITE_ASSISTANT_NAV_PILOT_USER_IDS', 'trainer-user')
    expect(todayHeaderProps(false, null)).toEqual({ title: 'Сегодня', hideTitle: false, showProfileAvatar: true })
  })
})
