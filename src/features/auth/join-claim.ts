export function nextAutomaticInviteClaim(
  codeFromLink: string | null,
  attemptedCode: string | null,
): string | null {
  if (!codeFromLink || codeFromLink === attemptedCode) return null
  return codeFromLink
}
