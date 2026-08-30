import { expect, type Page } from '@playwright/test'

type AccessibilityIssue = { selector: string; reason: string; width?: number; height?: number }

export async function expectMonochromeAccessibility(page: Page) {
  const identity = page.locator('.ui-identity, .auth-flow-identity').first()
  if (await identity.count() === 0) return

  const issues = await page.evaluate(() => {
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    }
    const selector = (element: HTMLElement) => {
      const id = element.id ? `#${element.id}` : ''
      const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join('')
      const text = element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 48)
      return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` (${text})` : ''}`
    }
    const accessibleName = (element: HTMLElement) => {
      const ariaLabel = element.getAttribute('aria-label')?.trim()
      if (ariaLabel) return ariaLabel
      const labelledBy = element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ')
      if (labelledBy) return labelledBy
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const labels = [...element.labels ?? []].map((label) => label.textContent?.trim()).filter(Boolean).join(' ')
        if (labels) return labels
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        if (element.placeholder.trim()) return element.placeholder.trim()
      }
      // innerText can be empty for an otherwise named control while its
      // ancestor is moving between responsive layouts. textContent mirrors
      // the text alternative used by the browser more reliably in that case.
      return element.innerText.trim() || element.textContent?.trim() || element.getAttribute('title')?.trim() || ''
    }

    const found: AccessibilityIssue[] = []
    const interactive = [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="menuitem"], [role="switch"], [role="radio"]')]
      .filter(visible)
    for (const element of interactive) {
      if (!accessibleName(element)) found.push({ selector: selector(element), reason: 'missing accessible name' })
    }

    const targetControls = interactive.filter((element) => {
      if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) && element.labels?.length) return false
      if (element.matches('a[href]')) return element.matches('.tab-bar a, .button, .page-back, .today-profile-avatar, [role="button"]')
      return element.matches('button, summary, input, select, textarea, [role="button"], [role="menuitem"], [role="switch"], [role="radio"]')
    })
    for (const element of targetControls) {
      const rect = element.getBoundingClientRect()
      // SVG body zones deliberately use a transparent stroked path as the
      // pointer target. SVG bounding boxes omit that stroke, so include it in
      // the effective target instead of reporting the visible shape only.
      const svgHit = element.querySelector<SVGGraphicsElement>('.body-progress-region-hit')
      const hitRect = svgHit?.getBoundingClientRect()
      const hitStroke = svgHit ? Number.parseFloat(getComputedStyle(svgHit).strokeWidth) || 0 : 0
      const width = Math.max(rect.width, (hitRect?.width ?? 0) + hitStroke)
      const height = Math.max(rect.height, (hitRect?.height ?? 0) + hitStroke)
      if (width + .5 < 44 || height + .5 < 44) {
        found.push({ selector: selector(element), reason: 'interactive target below 44px', width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 })
      }
    }
    return found
  })

  expect(issues, `Accessibility contract violations on ${page.url()}`).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}
