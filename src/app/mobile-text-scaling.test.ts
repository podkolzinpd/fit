import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mobile text scaling', () => {
  it('keeps iOS Safari from inflating individual text blocks', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8')
    const rootRule = styles.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rootRule).toContain('-webkit-text-size-adjust:100%')
    expect(rootRule).toContain('text-size-adjust:100%')
  })
})
