import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TrainerProfileDraft } from '../../shared/domain'
import { TrainerProfileCard } from './TrainerProfileCard'

const completeProfile: TrainerProfileDraft = {
  displayName: 'Анна Иванова',
  bio: 'Помогаю тренироваться регулярно и безопасно.',
  specialties: ['Силовые', 'Бег'],
  city: 'Москва',
  metroStationIds: ['msk-dinamo', 'msk-tsska'],
  customLocations: ['World Class Динамо'],
  trainingModes: ['online', 'in_person'],
  experienceStartYear: new Date().getFullYear() - 3,
  education: 'Высшее физкультурное образование.',
  formats: 'Созвон и персональный план.',
  price: 'От 3 000 ₽',
  acceptingClients: true,
  avatarDataUrl: 'data:image/png;base64,AA==',
  certificates: [{ title: 'Персональный тренер', organization: 'Fit Academy', year: 2025 }],
}

describe('TrainerProfileCard', () => {
  it('shows every useful section in a full public profile', () => {
    render(<TrainerProfileCard profile={completeProfile} publicView primaryAction={<button>Написать</button>} footer={<p>Подвал</p>} />)

    expect(screen.getByRole('heading', { name: 'Анна Иванова' })).toBeVisible()
    expect(screen.getByText('Берёт новых клиентов')).toBeVisible()
    expect(screen.getByRole('list', { name: 'Направления' })).toHaveTextContent('СиловыеБег')
    expect(screen.getByText('Онлайн · Лично')).toBeVisible()
    expect(screen.getByText('3 года')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Где тренирует' })).toBeVisible()
    expect(screen.getByRole('list', { name: 'Станции метро' })).toHaveTextContent('ДинамоЦСКА')
    expect(screen.getByRole('list', { name: 'Места тренировок' })).toHaveTextContent('World Class Динамо')
    expect(screen.getByRole('button', { name: 'Написать' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Написать' }).closest('.trainer-card-primary-action')).not.toBeNull()
    expect(screen.getByText('Персональный тренер')).toBeVisible()
    expect(screen.getByText('Подвал')).toBeVisible()
  })

  it('keeps a minimal compact profile free of empty sections', () => {
    const minimal: TrainerProfileDraft = {
      ...completeProfile,
      displayName: 'Борис',
      bio: '',
      specialties: [],
      city: '',
      metroStationIds: [],
      customLocations: [],
      trainingModes: [],
      experienceStartYear: null,
      education: '',
      formats: '',
      price: '',
      acceptingClients: false,
      avatarDataUrl: null,
      certificates: [],
    }
    const { container } = render(<TrainerProfileCard profile={minimal} compact />)

    expect(screen.getByText('Сейчас без новых клиентов')).toBeVisible()
    expect(container.querySelector('.trainer-card-facts')).toBeEmptyDOMElement()
    expect(container.querySelectorAll('details')).toHaveLength(0)
    expect(container.querySelector('img')).toBeNull()
  })

  it('uses correct singular and first-year experience labels', () => {
    const { rerender } = render(<TrainerProfileCard profile={{ ...completeProfile, experienceStartYear: new Date().getFullYear() }} />)
    expect(screen.getByText('Меньше года')).toBeVisible()
    rerender(<TrainerProfileCard profile={{ ...completeProfile, experienceStartYear: new Date().getFullYear() - 1 }} />)
    expect(screen.getByText('1 год')).toBeVisible()
  })

  it('exposes a clear photo action only when the caller enables it', async () => {
    const user = userEvent.setup()
    const onAvatarClick = vi.fn()
    const { rerender } = render(<TrainerProfileCard profile={completeProfile} publicView />)
    expect(screen.queryByRole('button', { name: 'Открыть фото тренера Анна Иванова' })).not.toBeInTheDocument()

    rerender(<TrainerProfileCard profile={completeProfile} publicView onAvatarClick={onAvatarClick} />)
    await user.click(screen.getByRole('button', { name: 'Открыть фото тренера Анна Иванова' }))
    expect(onAvatarClick).toHaveBeenCalledOnce()
  })
})
