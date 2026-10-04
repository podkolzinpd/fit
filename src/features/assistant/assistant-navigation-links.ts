export type AssistantNavigationLink = { path: string; label: string }

const LINK_MARKER = /\[\[fit-link:([^|\]\n]+)\|([^\]\n]+)\]\]/gu
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const STATIC_PATHS = new Set([
  '/assistant', '/chat', '/join', '/me', '/me/edit', '/me/settings', '/me/workouts', '/me/progress', '/me/progress?view=pro',
  '/me/progress?view=pro&mapMode=load#body-map', '/me/progress?view=pro&resultsOpen=1',
  '/me/progress#measurements', '/me/achievements', '/me/goal', '/me/finance', '/me/trainers',
  '/me/profile', '/workouts/new', '/today', '/clients', '/clients/new', '/clients/archive', '/schedule', '/schedule/templates',
  '/schedule/templates/new', '/exercises', '/finance', '/profile', '/profile/settings', '/profile/trainer',
])
const DYNAMIC_PATH = new RegExp(`^(?:/progress/${UUID}(?:\\?view=pro)?|/clients/${UUID}(?:/(?:workouts|goal|finance))?)$`, 'iu')

export function isSafeAssistantNavigationPath(path: string): boolean {
  return STATIC_PATHS.has(path) || DYNAMIC_PATH.test(path)
}

export function extractAssistantNavigationLinks(content: string): {
  content: string
  links: AssistantNavigationLink[]
} {
  const links: AssistantNavigationLink[] = []
  const withoutMarkers = content.replace(LINK_MARKER, (_marker, rawPath: string, rawLabel: string) => {
    const path = rawPath.trim()
    const label = rawLabel.trim()
    if (!label || label.length > 100 || !isSafeAssistantNavigationPath(path)) return ''
    links.push({ path, label })
    return ''
  })
  return { content: withoutMarkers.replace(/\n{3,}/gu, '\n\n').trim(), links }
}
