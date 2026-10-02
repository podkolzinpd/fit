import { render, cleanup } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantIcon, ClientsIcon, HomeIcon, MicIcon, MessageIcon, TodayIcon } from './icons'
import { FitLimeIconsContext, fitLimeOriginalIcons } from './fit-lime-icons'

afterEach(cleanup)
describe('original Fit Lime icon boundary', () => {
  it('preserves monochrome icons outside the server-gated provider', () => {
    const { container } = render(<TodayIcon />)
    expect(container.querySelector('circle')).not.toBeNull()
    expect(container.querySelector('image')).toBeNull()
  })
  it('uses native square exports, including voice, messages and navigation', () => {
    const { container } = render(<FitLimeIconsContext value={true}>
      <TodayIcon /><ClientsIcon /><AssistantIcon /><MicIcon /><MessageIcon /><HomeIcon />
    </FitLimeIconsContext>)
    expect(container.querySelectorAll('image')).toHaveLength(5)
    for (const asset of container.querySelectorAll('image')) {
      expect(asset.getAttribute('href')).toBeTruthy()
      expect(asset.getAttribute('width')).toBe('24')
      expect(asset.getAttribute('height')).toBe('24')
    }
    expect(container.querySelector('[data-icon="home"] path')).not.toBeNull()
    expect(Object.keys(fitLimeOriginalIcons)).toHaveLength(22)
  })
  it('preserves the gate in a dialog portal and removes it after leaving Lime', () => {
    const { rerender } = render(<FitLimeIconsContext value={true}>{createPortal(<ClientsIcon />, document.body)}</FitLimeIconsContext>)
    expect(document.querySelector('[data-original-icon="users"]')).not.toBeNull()
    rerender(<FitLimeIconsContext value={false}>{createPortal(<ClientsIcon />, document.body)}</FitLimeIconsContext>)
    expect(document.querySelector('[data-original-icon]')).toBeNull()
  })
})
