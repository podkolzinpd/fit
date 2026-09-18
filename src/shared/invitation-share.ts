import type { InvitationLinkSource } from './domain'

export function invitationShareUrl(
  token: string,
  source: InvitationLinkSource,
  origin = window.location.origin,
): string {
  const url = new URL('/invite', origin)
  url.hash = new URLSearchParams({ token, source }).toString()
  return url.toString()
}

export function invitationShareText(
  inviterName: string,
  targetRole: 'client' | 'trainer',
): string {
  return targetRole === 'trainer'
    ? `${inviterName} приглашает вас стать тренером в Fit.`
    : `${inviterName} приглашает вас тренироваться вместе в Fit.`
}
