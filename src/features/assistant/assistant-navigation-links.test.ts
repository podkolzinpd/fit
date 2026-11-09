import { describe, expect, it } from 'vitest'

import { extractAssistantNavigationLinks, isSafeAssistantNavigationPath } from './assistant-navigation-links'

describe('assistant navigation links', () => {
  it('extracts reviewed internal routes from persisted assistant copy', () => {
    expect(extractAssistantNavigationLinks('Здесь:\n[[fit-link:/me/progress?view=pro|Открыть ПРО]]')).toEqual({
      content: 'Здесь:',
      links: [{ path: '/me/progress?view=pro', label: 'Открыть ПРО' }],
    })
  })

  it('allows exact client routes and rejects external or invented destinations', () => {
    expect(isSafeAssistantNavigationPath('/progress/123e4567-e89b-42d3-a456-426614174000?view=pro')).toBe(true)
    expect(isSafeAssistantNavigationPath('https://example.com')).toBe(false)
    expect(isSafeAssistantNavigationPath('//example.com')).toBe(false)
    expect(extractAssistantNavigationLinks('[[fit-link:https://example.com|Внешняя ссылка]]').links).toEqual([])
  })

  it.each([
    '/join', '/me?entry=workout', '/me/edit', '/me/settings', '/clients/new', '/clients/archive',
    '/today?view=compose', '/today?view=compose&entry=text',
    '/schedule/templates/new/editor', '/schedule/templates/from-workout',
    '/progress/123e4567-e89b-42d3-a456-426614174000?view=measurements',
    '/clients/123e4567-e89b-42d3-a456-426614174000/edit',
  ])('allows a reviewed destination: %s', (path) => {
    expect(isSafeAssistantNavigationPath(path)).toBe(true)
  })
})
