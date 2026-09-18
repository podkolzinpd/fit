const INVITATION_RETURN_KEY = 'fit.auth.invitationReturn'
const INVITATION_ROLE_KEY = 'fit.auth.invitationRole'
const INVITATION_CODE_PATTERN = /^[A-Z0-9]{12}$/
const INVITATION_TOKEN_PATTERN = /^[A-F0-9]{12}\.[0-9a-f]{64}$/

export function normalizeInvitationLinkToken(value: string | null | undefined): string | null {
  const token = value?.trim() ?? ''
  return INVITATION_TOKEN_PATTERN.test(token) ? token : null
}

export function invitationAuthPath(path: string | null | undefined): string | null {
  if (path === null || path === undefined) return null
  try {
    const base = new URL('https://fit.local')
    const url = new URL(path, base)
    if (url.origin !== base.origin || url.hash !== '') return null

    if (url.pathname === '/join') {
      if ([...url.searchParams.keys()].some((key) => key !== 'code')) return null
      const codes = url.searchParams.getAll('code')
      if (codes.length !== 1) return null
      const code = codes[0]?.trim().toUpperCase() ?? ''
      return INVITATION_CODE_PATTERN.test(code) ? `/join?code=${code}` : null
    }

    if (url.pathname === '/invite') {
      if ([...url.searchParams.keys()].some((key) => key !== 'token')) return null
      const tokens = url.searchParams.getAll('token')
      if (tokens.length !== 1) return null
      const token = normalizeInvitationLinkToken(tokens[0])
      return token === null ? null : `/invite?token=${token}`
    }

    return null
  } catch {
    return null
  }
}

export function savePendingInvitation(
  returnTo: string | null | undefined,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = sessionStorage,
  role?: 'client' | 'trainer' | null,
): void {
  const path = invitationAuthPath(returnTo)
  if (path === null) {
    storage.removeItem(INVITATION_RETURN_KEY)
    storage.removeItem(INVITATION_ROLE_KEY)
    return
  }
  storage.setItem(INVITATION_RETURN_KEY, path)
  const targetRole = role ?? (path.startsWith('/join?') ? 'client' : null)
  if (targetRole === null) storage.removeItem(INVITATION_ROLE_KEY)
  else storage.setItem(INVITATION_ROLE_KEY, targetRole)
}

export function readPendingInvitation(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): string | null {
  return invitationAuthPath(storage.getItem(INVITATION_RETURN_KEY))
}

export function readPendingInvitationRole(
  storage: Pick<Storage, 'getItem'> = sessionStorage,
): 'client' | 'trainer' | null {
  const role = storage.getItem(INVITATION_ROLE_KEY)
  return role === 'client' || role === 'trainer' ? role : null
}

export function consumePendingInvitation(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = sessionStorage,
): string | null {
  const path = readPendingInvitation(storage)
  storage.removeItem(INVITATION_RETURN_KEY)
  storage.removeItem(INVITATION_ROLE_KEY)
  return path
}
