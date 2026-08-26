import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { BodyMapAppearanceSetting } from './BodyMapAppearanceSetting'

describe('BodyMapAppearanceSetting', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        clear: () => storage.clear(),
      },
    })
  })

  it('keeps the client choice private and switches between the matching real figure and scheme', async () => {
    const user = userEvent.setup()
    render(<BodyMapAppearanceSetting
      viewerUserId="client-1"
      role="client"
      clientId="client-1"
      gender="female"
    />)

    expect(screen.getByText('Личный выбор — тренер его не увидит')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Реальная фигура' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Схема' }))

    expect(screen.getByRole('radio', { name: 'Схема' })).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('fit.bodyMapDisplay.client.client-1.client-1')).toBe('scheme')
  })

  it('renders one trainer account choice for progress maps', async () => {
    const user = userEvent.setup()
    render(<BodyMapAppearanceSetting
      viewerUserId="trainer-1"
      role="trainer"
      gender={null}
    />)

    expect(screen.getByText('Фигура на карте тела')).toBeInTheDocument()
    expect(screen.getByText('Ваш выбор для карт прогресса спортсменов')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Реальная фигура' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Схема' }))

    expect(window.localStorage.getItem('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('scheme')
  })

  it('uses only the scheme when the client gender is unknown', () => {
    render(<BodyMapAppearanceSetting
      viewerUserId="client-3"
      role="client"
      clientId="client-3"
      gender={null}
    />)

    expect(screen.queryByRole('radio', { name: 'Реальная фигура' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Схема' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Для реальной фигуры укажите пол спортсмена')).toBeInTheDocument()
  })
})
