import { expect, test } from '@playwright/test'
import { mockNativeAiSession, nativeAiUrl } from './native-ai-fixture'
import { conversationId, messageId } from './fit-lime-fixtures'

const profileId = 'a5510000-0000-4000-8000-000000000001'

test('native Assistant restores existing history after an error without legacy transport', async ({ page }, testInfo) => {
  const legacyRequests: string[] = []
  let createdConversations = 0
  let unavailable = true
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.hostname.endsWith('.supabase.co') || url.port === '54321' || /\/(rest|auth|functions)\/v1\//.test(url.pathname)) {
      legacyRequests.push(url.pathname)
      return route.abort('blockedbyclient')
    }
    return route.fallback()
  })
  await mockNativeAiSession(page, 'trainer', { profileId })
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00Z'))
  await page.route('**/v1/assistant/conversations', route => {
    if (route.request().method() === 'POST') {
      createdConversations++
      return route.fulfill({ status: 500, json: { error: 'unexpected_conversation_creation' } })
    }
    return route.fulfill(unavailable
      ? { status: 503, json: { error: 'unavailable' } }
      : { json: { conversations: [{ id: conversationId, title: 'Существующий диалог', createdAt: '2026-10-21T09:00:00Z' }] } })
  })
  await page.route(`**/v1/assistant/conversations/${conversationId}/messages`, route => route.fulfill({ json: { messages: [{
    id: messageId, conversationId, turnId: null, author: 'assistant', content: 'Сохранённый native диалог', action: null, createdAt: '2026-10-21T09:01:00Z',
  }] } }))
  await page.goto(nativeAiUrl('/assistant'))
  const composer = page.getByRole('textbox', { name: 'Сообщение ассистенту' })
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить сессию ассистента')
  await expect(composer).toBeDisabled()
  unavailable = false
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()

  // The original three widths retain their containment/overflow contract.
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByText('Сохранённый native диалог', { exact: true })).toBeVisible()
    await expect(composer).toBeEnabled()
    await expect(page.locator('.assistant-composer')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`native-assistant-history-${viewport.width}.png`) })
  }
  await page.reload()
  await expect(page.getByText('Сохранённый native диалог', { exact: true })).toBeVisible()
  expect(createdConversations).toBe(0)
  expect(legacyRequests).toEqual([])
})
