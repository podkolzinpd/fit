import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import { RepositoryError } from '../../data/repositories/error'
import type { NutritionRepository } from '../../data/repositories/nutrition.repository'
import { localDate } from '../../shared/local-date'
import { scaledNutrition, type NutritionDay, type NutritionEntry } from '../../shared/nutrition'
import { NutritionPage, NutritionSummary } from './NutritionPage'
import { readNutritionForm } from './draft'

const fixture = vi.hoisted(() => ({ enabled: true, role: 'client', userId: 'f00d0000-6010-4000-8000-000000000001',
  day: vi.fn<NutritionRepository['day']>(), search: vi.fn<NutritionRepository['search']>(), recent: vi.fn<NutritionRepository['recent']>(),
  save: vi.fn<NutritionRepository['save']>(), setDeleted: vi.fn<NutritionRepository['setDeleted']>(),
  consents: vi.fn<NutritionRepository['consents']>(), setConsent: vi.fn<NutritionRepository['setConsent']>(), get: vi.fn() }))
vi.mock('../../app/auth-context', () => ({ useAuth: () => ({ actor: { userId: fixture.userId, role: fixture.role, timezone: 'Europe/Moscow' } }) }))
vi.mock('../../app/feature-flags', () => ({ isNutritionPilotEnabled: () => fixture.enabled }))
vi.mock('../../app/data-backend-context', () => ({ useDataBackend: () => ({ nutrition: fixture, clients: { get: fixture.get } }) }))
vi.mock('../chat', () => ({ ChatStartButton: () => <button>Написать</button> }))

const entry: NutritionEntry = { id: 'f00d0000-6010-4000-8000-000000000013', day: '2026-10-10', meal: 'lunch',
  name: 'Курица с рисом', basis: '100g', grams: 150, calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8,
  totals: { calories: 228.3, protein: 14.7, fat: 6.3, carbs: 28.2 }, version: 3, updatedAt: '2026-10-10T09:00:00Z', deletedAt: null }
const empty: NutritionDay = { access: 'granted', entries: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 } }
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear(); localStorage.clear()
  fixture.enabled = true; fixture.role = 'client'
  fixture.day.mockResolvedValue(empty)
  fixture.search.mockResolvedValue({ foods: [], hasMore: false })
  fixture.recent.mockResolvedValue([entry])
  fixture.consents.mockResolvedValue([])
  fixture.get.mockResolvedValue({ fullName: 'Анна' })
  fixture.save.mockImplementation((draft) => Promise.resolve({ ...entry, id: draft.id, version: 1, day: draft.day, meal: draft.meal,
    grams: draft.grams, ...(draft.food.kind === 'manual' ? draft.food : {}), totals: scaledNutrition(entry, '100g', draft.grams) }))
})
function setup(path = '/me/nutrition?date=2026-10-10&action=add') {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={cache}><Routes>
    <Route path="/me/nutrition" element={<NutritionPage />} />
    <Route path="/clients/:clientId/nutrition" element={<NutritionPage />} />
    <Route path="/me" element={<p>Кабинет</p>} />
    <Route path="/summary" element={<NutritionSummary clientId="synthetic-client" />} />
  </Routes></QueryClientProvider></MemoryRouter>)
  return { ...result, user: userEvent.setup(), cache }
}

it('repeats the displayed snapshot and validates quantity without an automatic save', async () => {
  const { user } = setup()
  await user.click(await screen.findByRole('button', { name: /Курица с рисом/ }))
  expect(screen.getByLabelText('Сколько съели, г')).toHaveValue('150')
  expect(fixture.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Сколько съели, г'), { target: { value: '0' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Укажите вес больше 0 и не больше 20 000 г')).toBeVisible()
  expect(fixture.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Сколько съели, г'), { target: { value: '200,5' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 0, grams: 200.5,
    day: localDate('2026-10-10'), food: { kind: 'manual', name: entry.name, basis: '100g', calories: 152.2, protein: 9.8, fat: 4.2, carbs: 18.8 } })))
  await screen.findByText('Запись сохранена')
  expect(readNutritionForm(fixture.userId, 'new')).toBeNull()
})

it('manual portion needs only name and calories; unknown macros remain null', async () => {
  const { user } = setup()
  await user.click(screen.getByRole('button', { name: 'Добавить свою еду' }))
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(await screen.findByText('Укажите название еды')).toBeVisible()
  expect(fixture.save).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Название', { exact: true }), 'Домашний суп')
  await user.type(screen.getByLabelText('Калории съеденной порции'), '220')
  expect(screen.queryByLabelText('Сколько съели, г')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ grams: null,
    food: { kind: 'manual', name: 'Домашний суп', basis: 'portion', calories: 220, protein: null, fat: null, carbs: null } })))
})

it('disables the form during saving and retries the same operation after a lost response', async () => {
  let rejectSave: (error: Error) => void = () => undefined
  fixture.save.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectSave = reject }))
  const { user } = setup()
  await user.click(await screen.findByRole('button', { name: /Курица с рисом/ }))
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(screen.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled()
  expect(screen.getByLabelText('Сколько съели, г')).toBeDisabled()
  rejectSave(new RepositoryError('network_unavailable', 'Не удалось сохранить'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось сохранить')
  expect(screen.getByLabelText('Сколько съели, г')).toHaveValue('150')
  const first = fixture.save.mock.calls[0]?.[0]
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save).toHaveBeenCalledTimes(2))
  expect(fixture.save.mock.calls[1]?.[0]).toEqual(first)
})

it('preserves a conflicted edit until explicitly confirmed discard and loads the new version', async () => {
  fixture.day.mockResolvedValue({ ...empty, entries: [entry], totals: entry.totals })
  fixture.save.mockRejectedValueOnce(new RepositoryError('PT409', 'Данные уже изменились.'))
  const { user } = setup(`/me/nutrition?date=2026-10-10&edit=${entry.id}`)
  await screen.findByRole('heading', { name: 'Редактировать запись' })
  fireEvent.change(screen.getByLabelText('Сколько съели, г'), { target: { value: '180' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByRole('alert')
  expect(readNutritionForm(fixture.userId, entry.id)?.grams).toBe('180')
  await user.click(screen.getByRole('button', { name: 'Открыть актуальный дневник' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }))
  expect(screen.getByLabelText('Сколько съели, г')).toHaveValue('180')
  fixture.day.mockResolvedValue({ ...empty, entries: [{ ...entry, grams: 200, version: 4 }], totals: entry.totals })
  await user.click(screen.getByRole('button', { name: 'Открыть актуальный дневник' }))
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Вернуться к дневнику' }))
  await user.click(await screen.findByRole('link', { name: `Редактировать: ${entry.name}` }))
  expect(screen.getByLabelText('Сколько съели, г')).toHaveValue('200')
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save.mock.calls[1]?.[0]).toMatchObject({ expectedVersion: 4 }))
})

it('a trainer sees a locked state, never add/edit/delete, and can inspect allowed details', async () => {
  fixture.role = 'trainer'
  fixture.day.mockResolvedValue({ access: 'locked', entries: [], totals: null })
  const { user, cache } = setup('/clients/synthetic-client/nutrition?date=2026-10-10')
  expect(await screen.findByText(/Клиент пока не разрешил просмотр дневника/)).toBeVisible()
  expect(screen.queryByRole('link', { name: 'Добавить еду' })).toBeNull()
  fixture.day.mockResolvedValue({ ...empty, entries: [entry], totals: entry.totals })
  await cache.invalidateQueries({ queryKey: ['nutrition'] })
  await user.click(await screen.findByText('Подробности записи'))
  expect(screen.getByText('Справочные КБЖУ на 100 г')).toBeVisible()
  expect(screen.queryByRole('link', { name: /Редактировать/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Действия:/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Написать' })).toBeVisible()
})

it('shows a dated latest-record link without presenting it as today', async () => {
  fixture.role = 'trainer'
  fixture.day.mockResolvedValue({ ...empty, lastRecordedDay: '2026-10-09' })
  setup('/summary')
  expect(await screen.findByText('Сегодня записей нет')).toBeVisible()
  expect(screen.getByRole('link', { name: /Последние записи:/ })).toHaveAttribute('href', '/clients/synthetic-client/nutrition?date=2026-10-09')
})

it('hides the trainer card feature when this client is outside the server-authorized pilot, not on a network error', async () => {
  fixture.role = 'trainer'
  fixture.day.mockRejectedValue(new RepositoryError('PT403', 'Недостаточно прав'))
  const { cache } = setup('/summary')
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Питание сегодня' })).toBeNull())
  expect(screen.queryByRole('link', { name: 'Открыть дневник' })).toBeNull()
  fixture.day.mockRejectedValue(new RepositoryError('network_unavailable', 'Нет связи'))
  await cache.invalidateQueries({ queryKey: ['nutrition'] })
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.getByRole('region', { name: 'Питание сегодня' })).toBeVisible()
})

it('loading errors do not show a false empty diary or zero totals', async () => {
  fixture.day.mockRejectedValue(new Error('Нет связи'))
  setup('/me/nutrition?date=2026-10-10')
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText(/В этот день записей нет/)).toBeNull()
  expect(screen.queryByText('0 ккал')).toBeNull()
  expect(screen.getByRole('button', { name: 'Повторить' })).toBeVisible()
})

it('edits a manual portion name and calories with the displayed version, not just its date', async () => {
  const portion = { ...entry, name: 'Домашний суп', basis: 'portion' as const, grams: null, calories: 220,
    protein: null, fat: null, carbs: null, totals: { calories: 220, protein: null, fat: null, carbs: null } }
  fixture.day.mockResolvedValue({ ...empty, entries: [portion], totals: portion.totals })
  const { user } = setup(`/me/nutrition?date=2026-10-10&edit=${entry.id}`)
  expect(await screen.findByLabelText('Название')).toHaveValue('Домашний суп')
  fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Суп с курицей' } })
  fireEvent.change(screen.getByLabelText('Калории съеденной порции'), { target: { value: '250' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3, grams: null,
    food: { kind: 'manual', name: 'Суп с курицей', basis: 'portion', calories: 250, protein: null, fat: null, carbs: null } })))
})

it('can explicitly correct a per-100g snapshot while preserving quantity and basis', async () => {
  fixture.day.mockResolvedValue({ ...empty, entries: [entry], totals: entry.totals })
  const { user } = setup(`/me/nutrition?date=2026-10-10&edit=${entry.id}`)
  await user.click(await screen.findByRole('button', { name: 'Изменить название и КБЖУ' }))
  expect(screen.getByRole('switch', { name: 'На 100 г' })).toBeChecked()
  expect(screen.getByLabelText('Сколько съели, г')).toHaveValue('150')
  fireEvent.change(screen.getByLabelText('Калории на 100 г'), { target: { value: '160' } })
  await user.click(screen.getByRole('button', { name: 'Сохранить' }))
  await waitFor(() => expect(fixture.save.mock.calls[0]?.[0]).toMatchObject({ expectedVersion: 3, grams: 150,
    food: { kind: 'manual', basis: '100g', calories: 160 } }))
})

it('direct entry outside the cohort never requests nutrition data', async () => {
  fixture.enabled = false
  setup()
  expect(await screen.findByText('Кабинет')).toBeVisible()
  expect(fixture.day).not.toHaveBeenCalled()
  expect(fixture.recent).not.toHaveBeenCalled()
  expect(fixture.consents).not.toHaveBeenCalled()
})
