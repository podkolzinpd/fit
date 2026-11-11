const referralSourceKey = 'fit.referralSource'
const referralCodePattern = /^[a-z0-9-]{3,64}$/i

export function readReferralCode(): string | null {
  try {
    const code = window.localStorage.getItem(referralSourceKey)
    return code !== null && referralCodePattern.test(code) ? code.toLowerCase() : null
  } catch {
    return null
  }
}

export function saveReferralCode(value: string): string | null {
  if (!referralCodePattern.test(value)) return null
  const code = value.toLowerCase()
  try {
    window.localStorage.setItem(referralSourceKey, code)
  } catch {
    return null
  }
  return code
}

export function clearReferralCode(): void {
  try {
    window.localStorage.removeItem(referralSourceKey)
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
