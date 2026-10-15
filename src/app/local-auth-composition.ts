import { authRepository } from '../data/repositories/auth.repository'

export const localLegacyAvailable = true

export function getLocalAuthRepository() {
  return authRepository
}
