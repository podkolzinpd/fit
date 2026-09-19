import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  VitalMediaDeploymentError,
  validateVitalMediaManifestFiles,
  YandexVitalMediaDeployment,
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

  it('proves versioning with the intended manifest object and keeps it', async () => {
    const body = Buffer.from('reviewed-image')
    const file = {
      bytes: body.byteLength,
      path: 'reviewed-image.jpg',
      sha256: createHash('sha256').update(body).digest('hex'),
    }
    const send = vi.fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ VersionId: 'version-1' })
      .mockResolvedValueOnce({
        Body: { transformToByteArray: () => Promise.resolve(body) },
        ContentType: 'image/jpeg',
      })
    const deployment = new YandexVitalMediaDeployment({
      accessKeyId: 'access-key',
      bucket: 'private-bucket',
      secretAccessKey: 'secret-key',
    })
    ;(deployment as unknown as { client: { send: typeof send } }).client = { send }

    await expect(deployment.upload(file, body)).resolves.toEqual({
      outcome: 'uploaded',
      versioning: 'verified',
    })
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('stops after the first intended write when storage does not return a version', async () => {
    const body = Buffer.from('reviewed-image')
    const file = {
      bytes: body.byteLength,
      path: 'reviewed-image.jpg',
      sha256: createHash('sha256').update(body).digest('hex'),
    }
    const send = vi.fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({})
    const deployment = new YandexVitalMediaDeployment({
      accessKeyId: 'access-key',
      bucket: 'private-bucket',
      secretAccessKey: 'secret-key',
    })
    ;(deployment as unknown as { client: { send: typeof send } }).client = { send }

    await expect(deployment.upload(file, body))
      .rejects.toThrow('vital_media_object_version_missing')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('skips an exact object only when its current version is proven', async () => {
    const body = Buffer.from('reviewed-image')
    const sha256 = createHash('sha256').update(body).digest('hex')
    const send = vi.fn().mockResolvedValue({
      ContentLength: body.byteLength,
      ContentType: 'image/jpeg',
      Metadata: { 'source-sha256': sha256 },
      VersionId: 'version-1',
    })
    const deployment = new YandexVitalMediaDeployment({
      accessKeyId: 'access-key',
      bucket: 'private-bucket',
      secretAccessKey: 'secret-key',
    })
    ;(deployment as unknown as { client: { send: typeof send } }).client = { send }

    await expect(deployment.upload({
      bytes: body.byteLength,
      path: 'reviewed-image.jpg',
      sha256,
    }, body)).resolves.toEqual({ outcome: 'skipped', versioning: 'verified' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
