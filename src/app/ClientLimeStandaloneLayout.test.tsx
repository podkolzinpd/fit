import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth-context', () => ({ useAuth: () => ({ actor: null }) }))
vi.mock('./client-lime-theme', () => ({ useClientLimeTheme: () => ({ theme: 'light' }) }))

import { ClientLimeStandaloneLayout } from './ClientLimeStandaloneLayout'

describe('public invitation presentation boundary', () => {
  it('does not expand the guest identity gate for other public routes', () => {
    const result = render(<MemoryRouter><ClientLimeStandaloneLayout><p>Other public route</p></ClientLimeStandaloneLayout></MemoryRouter>)
    expect(screen.getByText('Other public route')).toBeVisible()
    expect(result.container.querySelector('.fit-client-lime-public')).toBeNull()
  })

  it('applies the approved invitation identity and releases document ownership on exit', () => {
    const result = render(<MemoryRouter><ClientLimeStandaloneLayout invitation><p>Public invitation</p></ClientLimeStandaloneLayout></MemoryRouter>)
    expect(result.container.querySelector('.fit-client-lime-public')).toHaveClass('theme-light')
    expect(document.documentElement).toHaveClass('fit-client-lime-document')
    result.unmount()
    expect(document.documentElement).not.toHaveClass('fit-client-lime-document')
  })
})
