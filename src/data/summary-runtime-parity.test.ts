import { describe, expect, it } from 'vitest'

import {
  SUMMARY_CHUNK_JSON_SCHEMA as apiChunkSchema,
  SUMMARY_CHUNK_SYSTEM_PROMPT as apiChunkPrompt,
  SUMMARY_JSON_SCHEMA as apiSummarySchema,
  SUMMARY_SYSTEM_PROMPT as apiSummaryPrompt,
} from '../../services/api/src/legacy-summary/summary-contract'
import {
  SUMMARY_CHUNK_JSON_SCHEMA as edgeChunkSchema,
  SUMMARY_CHUNK_SYSTEM_PROMPT as edgeChunkPrompt,
  SUMMARY_JSON_SCHEMA as edgeSummarySchema,
  SUMMARY_SYSTEM_PROMPT as edgeSummaryPrompt,
} from '../../supabase/functions/summarize-client-training/summary-contract'

describe('training summary runtime parity', () => {
  it('keeps final and chunk contracts identical in both production runtimes', () => {
    expect(apiSummarySchema).toEqual(edgeSummarySchema)
    expect(apiSummaryPrompt).toBe(edgeSummaryPrompt)
    expect(apiChunkSchema).toEqual(edgeChunkSchema)
    expect(apiChunkPrompt).toBe(edgeChunkPrompt)
  })
})
