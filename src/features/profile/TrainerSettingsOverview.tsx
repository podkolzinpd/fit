import { Capacitor } from '@capacitor/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { SessionActor } from '../../shared/domain'
import { BellIcon, ChevronRightIcon, ExerciseIcon, ScheduleIcon, SettingsIcon } from '../../shared/icons'
import { isCoachLiveDensityEnabled } from '../../app/coach-workout-redesign'
import { useCoachLiveDensity } from '../../app/coach-live-density'
import { readStoredScheduleDensity } from '../../app/schedule-density'
import { useAppTheme } from '../../app/theme'
import { CorporateAdminEntry } from '../corporate-admin'
import { LogoutButton } from '../auth'
import { useAppInstalled } from '../install'
import { NotificationsSetting } from '../notifications'
import { SettingsSection } from './SettingsSection'

export const TRAINER_SETTINGS_SECTIONS = {
  training: 'Тренировки', schedule: 'Расписание', notifications: 'Уведомления',
  appearance: 'Оформление', account: 'Аккаунт', help: 'Помощь и документы', install: 'Установка Fit', feedback: 'Обратная связь',
} as const
export type TrainerSettingsSection = keyof typeof TRAINER_SETTINGS_SECTIONS

export function trainerSettingsSection(value: string | null): TrainerSettingsSection | null {
  return value && Object.hasOwn(TRAINER_SETTINGS_SECTIONS, value) ? value as TrainerSettingsSection : null
}

export function TrainerSettingsLink({ section, label, summary, icon }: {
  section: TrainerSettingsSection; label?: string; summary?: ReactNode; icon?: ReactNode
}) {
  return <Link className="trainer-settings-link" to={`/profile/settings?section=${section}`} state={{ trainerSettingsParent: '/profile/settings' }}>
    {icon && <span className="trainer-settings-link-icon">{icon}</span>}
    <span className="trainer-settings-link-copy"><strong>{label ?? TRAINER_SETTINGS_SECTIONS[section]}</strong>{summary && <small>{summary}</small>}</span>
    <ChevronRightIcon />
  </Link>
}

export function TrainerSettingsOverview({ actor }: { actor: SessionActor }) {
  const density = useCoachLiveDensity(actor.userId)
  const theme = useAppTheme()
  const installed = useAppInstalled()
  const native = Capacitor.isNativePlatform()
  const grid = actor.preferences?.scheduleDensity ?? readStoredScheduleDensity(actor.userId) ?? 'comfortable'
  return <>
    <SettingsSection title="Приложение"><div className="trainer-settings-menu">
      <TrainerSettingsLink section="training" summary={isCoachLiveDensityEnabled(actor) ? `${density === 'compact' ? 'Компактный' : 'Оригинальный'} Live` : 'Параметры тренировки'} icon={<ExerciseIcon />} />
      <TrainerSettingsLink section="schedule" summary={`${grid === 'compact' ? 'Компактная' : 'Обычная'} сетка`} icon={<ScheduleIcon />} />
      <TrainerSettingsLink section="notifications" summary={<NotificationsSetting userId={actor.userId} role="trainer" summary />} icon={<BellIcon />} />
      <TrainerSettingsLink section="appearance" summary={theme === 'dark' ? 'Тёмная тема остальных экранов' : 'Светлая тема остальных экранов'} icon={<SettingsIcon />} />
      {!native && !installed && <TrainerSettingsLink section="install" label="Установить Fit" summary="На экран «Домой»" />}
    </div></SettingsSection>
    <SettingsSection title="Рабочие инструменты"><div className="menu trainer-settings-menu">
      <Link to="/exercises">Управление упражнениями<ChevronRightIcon /></Link>
      <Link to="/join">Ввести код приглашения<ChevronRightIcon /></Link>
    </div><CorporateAdminEntry /></SettingsSection>
    <SettingsSection title="Аккаунт и помощь"><div className="trainer-settings-menu">
      <TrainerSettingsLink section="account" label="Данные аккаунта" summary="Имя и часовой пояс" />
      <TrainerSettingsLink section="help" />
    </div></SettingsSection>
    <LogoutButton />
  </>
}
