import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary } from '../app/error-boundary'
import { NativeUpdateLifecycle } from './NativeUpdateLifecycle'
const initialize = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./android-ota', () => ({ initializeNativeOta: initialize }))
function BadRoot(): never { throw new Error('bad OTA root') }
describe('OTA readiness follows a successful root React commit', () => {
  it('does not acknowledge a bundle whose root render failed', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<AppErrorBoundary><BadRoot /><NativeUpdateLifecycle /></AppErrorBoundary>)
      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(initialize).not.toHaveBeenCalled()
    } finally { errors.mockRestore() }
  })
})
