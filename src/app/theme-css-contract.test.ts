import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('theme CSS contract', () => {
  it('overrides every theme-specific semantic surface in light mode', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    const lightTheme = styles.match(/\.phone-frame\.theme-light, \.theme-light\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''

    expect(lightTheme).toContain('--success-border:var(--border)')
    expect(lightTheme).toContain('--success-surface:var(--surface-raised)')
    expect(lightTheme).toContain('--success-mark-surface:var(--surface-sunken)')
    expect(lightTheme).toContain('--danger-border:var(--border)')
    expect(lightTheme).toContain('--danger-surface:var(--surface-raised)')
    expect(lightTheme).toContain('--danger-hover:var(--surface-sunken)')
    expect(lightTheme).toContain('--neutral-current:var(--surface-elevated)')
    expect(lightTheme).toContain('--neutral-current-border:var(--border)')
  })
})
