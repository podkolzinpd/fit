import { render as rtlRender, renderHook as rtlRenderHook, type RenderOptions, type RenderHookOptions } from '@testing-library/react'
import type { ReactNode, ReactElement } from 'react'
import type { DataBackend } from '../data/contracts/backend'
import { DataBackendContext } from '../app/data-backend-context'
import { nativeBackend } from './native-backend'

// Explicit native fixture for isolated component tests. Production has no
// implicit backend; tests still exercise the same repository implementation.
export function NativeBackendFixture({ children, backend = nativeBackend }: { children: ReactNode; backend?: DataBackend }) {
  return <DataBackendContext value={backend}>{children}</DataBackendContext>
}

export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(<NativeBackendFixture>{ui}</NativeBackendFixture>, options)
}

export function renderHook<Result, Props>(callback: (props: Props) => Result, options?: RenderHookOptions<Props>) {
  const Wrapper = options?.wrapper
  return rtlRenderHook(callback, { ...options, wrapper: ({ children }) => <NativeBackendFixture>{Wrapper ? <Wrapper>{children}</Wrapper> : children}</NativeBackendFixture> })
}

