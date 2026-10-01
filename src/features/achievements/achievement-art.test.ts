import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { achievementArt } from './achievement-art'

// SHA-256 of the exact PNG files shown on the owner-approved 21-icon sheet.
const approvedHashes: Record<string, string> = {
  'achievement-cardio-10h-concept-20261001.png': 'b974796ed0b96e18698006cb9ff599427e744eb9822d0602f5161799d95e3780',
  'achievement-cardio-50h-concept-20261001.png': 'c9f90d932771a12c5b4222cf153e97e13ec366f078350edddcaf99f2833dd554',
  'achievement-cardio-first-hour-concept-20261001.png': '17a1ebbfa8abedb0c62f8a3369bde8c2674f2e7307da7818e237e1d743098e86',
  'achievement-distance-250km-concept-20261001.png': 'faff655149d244661ac997bd2059c660831c4812a008f8015ee90b86b6d46f4b',
  'achievement-distance-50km-concept-v2-20261001.png': '78ed859d0273dae91649469b3c337d2724f2e9c9b3a9547ecf419a5f3cfd21b2',
  'achievement-distance-5km-concept-20261001.png': '064bcd4a776c392ffe59775fd279577cae3cbb473ef24bc2f0b1863bea9aa974',
  'achievement-distinct-pr-trophy-1-concept-20261001.png': 'b950bcdec6938c5086b4dfe10e0262a9cda3516944fcb16fd772d09aa58dea5c',
  'achievement-distinct-pr-trophy-10-concept-20261001.png': '86acf9982a5cd09621bb96582e7d5fcc0afc6eea42b4d311d27f474a4a5d3ee0',
  'achievement-distinct-pr-trophy-3-concept-20261001.png': '274e379c3fedad25ad5c9d7b11430823089500bdbd45da47014ce3a363b8c687',
  'achievement-exercise-variety-15-concept-20261001.png': '99e51be1e0bfee0dfc2231c7964ae37d36665ee253e2bc3bf8080ea5b665a90a',
  'achievement-exercise-variety-3-concept-20261001.png': '4de78d8e276336c029ee2df080ee12058ccabe1b52063572b873aa49ca920592',
  'achievement-exercise-variety-40-concept-20261001.png': '58bcdde55e93ad274def8ad4f37ef934dcd6967cab24fe3fa5efe08f3ec29c35',
  'achievement-lifetime-tonnage-100t-concept-20261001.png': '11839cd3463d1a4ff0cc17370f65eedd35728b1e03dd1966b462d3e418045add',
  'achievement-lifetime-tonnage-10t-concept-20261001.png': 'e485a7e18cb1201f8aaa7267f06c6476245d5f5ffe9060c2c5dd22b1635f74b3',
  'achievement-lifetime-tonnage-500t-concept-v2-20261001.png': '32a1c05a835e8340f2e6d616dd1cf8e642dcb7671f4721b41725e3eb25ea994f',
  'achievement-plank-2h-concept-20261001.png': 'b1bae4a15c792000f92586bd7a6130fc0baee8dfc816c4d21cc46f8de3a7da1c',
  'achievement-plank-30m-concept-20261001.png': '29d18cdfe7189efe1020e970472d09ab3a825dcb2d4dfcb2815e258f8dcfe380',
  'achievement-reference-plank-20261001.png': 'f513e1f7c594d365eaa6704599ddad4c1f82e1893d8ad5bd246f75a9f5ee96f5',
  'achievement-workout-tonnage-10t-concept-20261001.png': '942bbcff441d75e16374fe65ce09386dfd570285702ef201ef07e9e711bd6833',
  'achievement-workout-tonnage-1t-concept-20261001.png': '6beb67e303e9c8517a01397f589ea3466af3b5a18f78e3c124922b78e71c5ea0',
  'achievement-workout-tonnage-5t-concept-20261001.png': 'df9c2d2b378d9797ce491df8441983b5e65fe57b7fc0c9ef8d0a292d48cd4527',
}

describe('owner-approved achievement artwork', () => {
  it('maps exactly 21 unchanged PNGs, including the existing first-record replacement', () => {
    const entries = Object.entries(achievementArt)
    expect(entries).toHaveLength(21)
    expect(achievementArt['records-1']?.file).toBe('achievement-distinct-pr-trophy-1-concept-20261001.png')
    expect(new Set(entries.map(([, art]) => art.file)).size).toBe(21)
    for (const [, art] of entries) {
      const bytes = readFileSync(resolve(process.cwd(), 'public/achievements', art.file))
      expect(createHash('sha256').update(bytes).digest('hex'), art.file).toBe(approvedHashes[art.file])
    }
  })
})
