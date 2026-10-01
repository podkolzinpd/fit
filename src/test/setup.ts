import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Newer Node versions can shadow jsdom's storage with an undefined global.
// Give each isolated test file a browser-like store without a Node disk file.
const entries = new Map<string, string>()
const browserStorage: Storage = window.localStorage ?? {
  get length() { return entries.size },
  clear: () => entries.clear(),
  getItem: (key) => entries.get(key) ?? null,
  key: (index) => [...entries.keys()][index] ?? null,
  removeItem: (key) => { entries.delete(key) },
  setItem: (key, value) => { entries.set(key, String(value)) },
}
Object.defineProperty(window, 'localStorage', { configurable: true, value: browserStorage })
vi.stubGlobal('localStorage', browserStorage)

afterEach(cleanup)
