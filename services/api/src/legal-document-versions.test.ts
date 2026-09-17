import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from './legal-document-versions.js'

interface LegalDocuments {
  privacy: { sourceTextSha256: string }
  terms: { sourceTextSha256: string }
}

describe('Yandex legal document versions', () => {
  it('match the frontend legal source hashes', async () => {
    const raw = await readFile(
      new URL('../../../src/shared/legal-documents.json', import.meta.url),
      'utf8',
    )
    const documents = JSON.parse(raw) as LegalDocuments
    expect(CURRENT_TERMS_VERSION).toBe(
      `sha256:${documents.terms.sourceTextSha256.slice(0, 24)}`,
    )
    expect(CURRENT_PRIVACY_VERSION).toBe(
      `sha256:${documents.privacy.sourceTextSha256.slice(0, 24)}`,
    )
  })
})
