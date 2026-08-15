import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authRepository } from './auth.repository'

const queries = vi.hoisted(() => ({
  signIn: vi.fn(),
  getLinkedClient: vi.fn(),
  getTrainer: vi.fn(),
  initializeAccount: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('../queries/auth.queries', () => ({
  authQueries: {
    signIn: queries.signIn,
    getLinkedClient: queries.getLinkedClient,
    getTrainer: queries.getTrainer,
    initializeAccount: queries.initializeAccount,
    getProfile: queries.getProfile,
    updateProfile: queries.updateProfile,
  },
}))

describe('authRepository.initialize', () => {
  beforeEach(() => {
    queries.signIn.mockReset()
    queries.getLinkedClient.mockReset()
    queries.getTrainer.mockReset()
    queries.initializeAccount.mockReset()
    queries.getProfile.mockReset()
    queries.updateProfile.mockReset()
  })

  it('повторяет вход один раз после краткого сетевого обрыва', async () => {
    queries.signIn
      .mockResolvedValueOnce({ error: new TypeError('Failed to fetch') })
      .mockResolvedValueOnce({ error: null })

    await expect(authRepository.signIn('trainer@example.test', 'FitLocal123!')).resolves.toBeUndefined()
    expect(queries.signIn).toHaveBeenCalledTimes(2)
  })

  it('не повторяет вход при неверных учётных данных', async () => {
    queries.signIn.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })

    await expect(authRepository.signIn('trainer@example.test', 'wrong-password')).rejects.toThrow('Неверный email или пароль')
    expect(queries.signIn).toHaveBeenCalledTimes(1)
  })

  it('resolves a linked client without creating a trainer profile', async () => {
    queries.getLinkedClient.mockResolvedValue({
      data: {
        id: 'client-1',
        trainer_id: 'trainer-1',
        full_name: 'Анна Смирнова',
      },
      error: null,
    })
    queries.getProfile.mockResolvedValue({
      data: { first_name: 'Анна', last_name: 'Смирнова', timezone: 'Europe/Berlin', account_role: 'client' },
      error: null,
    })

    const actor = await authRepository.initialize({
      id: 'auth-client-1',
      email: 'client@example.test',
      user_metadata: { role: 'trainer' },
    })

    expect(actor).toEqual({
      kind: 'client',
      role: 'client',
      userId: 'auth-client-1',
      email: 'client@example.test',
      firstName: 'Анна',
      lastName: 'Смирнова',
      timezone: 'Europe/Berlin',
      clientId: 'client-1',
      trainerId: 'trainer-1',
      fullName: 'Анна Смирнова',
    })
    expect(queries.getTrainer).not.toHaveBeenCalled()
    expect(queries.initializeAccount).not.toHaveBeenCalled()
  })

  it('initializes an unlinked account as a trainer', async () => {
    queries.getLinkedClient.mockResolvedValue({ data: null, error: null })
    queries.getTrainer.mockResolvedValue({ data: null, error: null })
    queries.initializeAccount.mockResolvedValue({ data: null, error: null })
    queries.getProfile
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          first_name: 'Ирина',
          last_name: null,
          timezone: 'Europe/Moscow',
        },
        error: null,
      })

    const actor = await authRepository.initialize({
      id: 'trainer-1',
      email: 'trainer@example.test',
      user_metadata: { first_name: 'Ирина' },
    })

    expect(actor.kind).toBe('trainer')
    expect(queries.initializeAccount).toHaveBeenCalledWith('trainer', 'Ирина', undefined, expect.any(String))
  })

  it('не перезаписывает сохранённое имя регистрационными metadata', async () => {
    queries.getLinkedClient.mockResolvedValue({ data: null, error: null })
    queries.getTrainer.mockResolvedValue({ data: { profile_id: 'trainer-1' }, error: null })
    queries.getProfile.mockResolvedValue({
      data: {
        account_role: 'trainer',
        first_name: 'Новое имя',
        last_name: null,
        timezone: 'Europe/Moscow',
      },
      error: null,
    })

    const actor = await authRepository.initialize({
      id: 'trainer-1',
      email: 'trainer@example.test',
      user_metadata: { first_name: 'Старое имя' },
    })

    expect(actor.firstName).toBe('Новое имя')
    expect(queries.initializeAccount).not.toHaveBeenCalled()
  })

  it('не сохраняет некорректный часовой пояс профиля', async () => {
    await expect(authRepository.updateProfile({
      kind: 'trainer',
      role: 'trainer',
      userId: 'trainer-1',
      email: 'trainer@example.test',
      firstName: 'Ирина',
      lastName: null,
      timezone: 'Moscow',
    })).rejects.toThrow('Укажите часовой пояс в формате Europe/Moscow')
    expect(queries.updateProfile).not.toHaveBeenCalled()
  })
})
