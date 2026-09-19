import { describe, expect, it } from 'vitest'

import {
  VitalMediaDeploymentError,
  validateVitalMediaManifestFiles,
} from './vital-media-deployment.js'

function validFiles() {
  const files = []
  let remainingBytes = 71_514_430
  for (let index = 0; index < 2_010; index += 1) {
    const bytes = Math.floor(remainingBytes / (2_010 - index))
    remainingBytes -= bytes
    files.push({
      bytes,
      path: `exercise-${index}.${index % 3 === 2 ? 'mp4' : 'jpg'}`,
      sha256: index.toString(16).padStart(64, '0'),
    })
  }
  return files
}

describe('Vital media deployment contract', () => {
  it('accepts only the exact aggregate reviewed package contract', () => {
    const files = validFiles()
    const result = validateVitalMediaManifestFiles(files)

    expect(result.bytes).toBe(71_514_430)
    expect(result.fingerprint).toMatch(/^[a-f0-9]{16}$/)
  })

  it('rejects path duplication and changed aggregate size', () => {
    const duplicate = validFiles()
    duplicate[1]!.path = duplicate[0]!.path
    expect(() => validateVitalMediaManifestFiles(duplicate))
      .toThrow(VitalMediaDeploymentError)

    const changedSize = validFiles()
    changedSize[0]!.bytes += 1
    expect(() => validateVitalMediaManifestFiles(changedSize))
      .toThrow('vital_media_manifest_bytes_invalid')
  })
})
