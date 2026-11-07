import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readPreferenceStorage, writePreferenceStorage } from '../../app/preference-storage'
import { PreferenceStorageNotice } from './PreferenceStorageNotice'

const message = 'Не удалось сохранить на устройстве. После перезагрузки выбор может сброситься.'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

describe('PreferenceStorageNotice', () => {
  it('shows one section notice until all failed writes in that section recover', () => {
    render(<PreferenceStorageNotice keys={['notice-a', 'notice-b']} />)
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    const blocked = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    act(() => {
      writePreferenceStorage('notice-a', 'true')
      writePreferenceStorage('notice-b', 'false')
    })
    expect(screen.getAllByText(message)).toHaveLength(1)
    blocked.mockRestore()
    act(() => writePreferenceStorage('notice-a', 'true'))
    expect(screen.getByText(message)).toBeVisible()
    act(() => writePreferenceStorage('notice-b', 'false'))
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })

  it('does not show another account or section failure and clears an externally saved override', () => {
    const view = render(<PreferenceStorageNotice keys={['account-a']} />)
    const blocked = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    act(() => writePreferenceStorage('account-a', 'transient'))
    view.rerender(<PreferenceStorageNotice keys={['account-b']} />)
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    view.rerender(<PreferenceStorageNotice keys={['account-a']} />)
    expect(screen.getByText(message)).toBeVisible()
    blocked.mockRestore()
    localStorage.setItem('account-a', 'external')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'account-a' })))
    expect(readPreferenceStorage('account-a')).toBe('external')
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
})
