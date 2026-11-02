import { Capacitor } from '@capacitor/core'
import type { InvitationLinkSource } from './domain'

function invitationOrigin(origin: string): string {
  return Capacitor.isNativePlatform() ? 'https://fit-training.ru' : origin
}

export function invitationShareUrl(
  token: string,
  source: InvitationLinkSource,
  origin = window.location.origin,
): string {
  const url = new URL('/invite', invitationOrigin(origin))
  url.search = new URLSearchParams({ token, source }).toString()
  return url.toString()
}

export function corporateInvitationShareUrl(token: string, origin = window.location.origin): string {
  const url = new URL('/corporate-invite', invitationOrigin(origin))
  url.hash = new URLSearchParams({ token }).toString()
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
