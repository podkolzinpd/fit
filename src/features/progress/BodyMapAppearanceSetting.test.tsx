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

  it('keeps the client choice private and switches between the matching real figure and list', async () => {
    const user = userEvent.setup()
    render(<BodyMapAppearanceSetting
      viewerUserId="client-1"
      role="client"
      clientId="client-1"
      gender="female"
    />)

    expect(screen.getByText('Личный выбор — тренер его не увидит')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Фигура' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Список' }))

    expect(screen.getByRole('radio', { name: 'Список' })).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem('fit.bodyMapDisplay.client.client-1.client-1')).toBe('list')
  })

  it('renders one trainer account choice for progress maps', async () => {
    const user = userEvent.setup()
    render(<BodyMapAppearanceSetting
      viewerUserId="trainer-1"
      role="trainer"
      gender={null}
    />)

    expect(screen.getByText('Вид карты тела')).toBeInTheDocument()
    expect(screen.getByText('Ваш выбор для карт прогресса спортсменов')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Фигура' })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Список' }))

    expect(window.localStorage.getItem('fit.bodyMapDisplay.trainer.trainer-1.account')).toBe('list')
  })

  it('uses only the list when the client gender is unknown', () => {
    render(<BodyMapAppearanceSetting
      viewerUserId="client-3"
      role="client"
      clientId="client-3"
      gender={null}
    />)

    expect(screen.queryByRole('radio', { name: 'Фигура' })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Список' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Для фигуры укажите пол спортсмена')).toBeInTheDocument()
  })

  it('shows the list for an existing scheme preference and lets the client restore the figure', async () => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', 'scheme')
    const user = userEvent.setup()
    render(<BodyMapAppearanceSetting viewerUserId="client-1" role="client" clientId="client-1" gender="female" />)

    expect(screen.getByRole('radio', { name: 'Список' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('radio', { name: 'Схема' })).not.toBeInTheDocument()
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('list')

    await user.click(screen.getByRole('radio', { name: 'Фигура' }))

    expect(screen.getByRole('radio', { name: 'Фигура' })).toHaveAttribute('aria-checked', 'true')
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('real')
  })

  it('restores the saved real figure choice when the client gender becomes available', () => {
    storage.set('fit.bodyMapDisplay.client.client-1.client-1', 'real')
    const view = render(<BodyMapAppearanceSetting viewerUserId="client-1" role="client" clientId="client-1" gender={null} />)

    expect(screen.getByRole('radio', { name: 'Список' })).toHaveAttribute('aria-checked', 'true')
    expect(storage.get('fit.bodyMapDisplay.client.client-1.client-1')).toBe('real')

    view.rerender(<BodyMapAppearanceSetting viewerUserId="client-1" role="client" clientId="client-1" gender="female" />)

    expect(screen.getByRole('radio', { name: 'Фигура' })).toHaveAttribute('aria-checked', 'true')
  })
})
