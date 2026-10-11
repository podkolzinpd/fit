// Pure session-storage boundary. Auth cleanup must not import feature screens,
// chat pages or cloud transports into otherwise offline consumers of useAuth.
export const NUTRITION_DRAFT_PREFIX = 'fit.nutrition-draft.'

export function clearNutritionForms() {
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
    keys.forEach((key) => { if (key?.startsWith(NUTRITION_DRAFT_PREFIX)) sessionStorage.removeItem(key) })
  } catch { /* Storage may be unavailable in private browsing. */ }
}
