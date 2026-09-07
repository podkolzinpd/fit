#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const projectRef = process.env.SUPABASE_PROJECT_ID?.trim()
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim()
if (!projectRef || !accessToken) throw new Error('Supabase deployment credentials are required')

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!response.ok) throw new Error(`Could not obtain the project deployment key: HTTP ${response.status}`)
const keys = await response.json()
const deploymentKey = keys.find((key) => key.type === 'secret')?.api_key
  ?? keys.find((key) => key.name === 'service_role')?.api_key
if (!deploymentKey) throw new Error('No server-side Supabase deployment key is available')

const supabase = createClient(`https://${projectRef}.supabase.co`, deploymentKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const bucket = supabase.storage.from('fit-exercise-media')
const { data: buckets, error: listError } = await supabase.storage.listBuckets()
if (listError) throw new Error(`Could not inspect the media bucket: ${listError.message}`)
if (!buckets.some(({ id }) => id === 'fit-exercise-media')) {
  const { error } = await supabase.storage.createBucket('fit-exercise-media', {
    public: false,
    allowedMimeTypes: ['video/mp4', 'image/jpeg'],
    fileSizeLimit: 1_048_576,
  })
  if (error) throw new Error(`Could not create the private media bucket: ${error.message}`)
} else {
  const { error } = await supabase.storage.updateBucket('fit-exercise-media', {
    public: false,
    allowedMimeTypes: ['video/mp4', 'image/jpeg'],
    fileSizeLimit: 1_048_576,
  })
  if (error) throw new Error(`Could not secure the media bucket: ${error.message}`)
}

const root = resolve(import.meta.dirname, '..')
const mediaDir = join(root, 'public/exercises/vital-pro')
const manifest = JSON.parse(await readFile(join(root, 'scripts/data/vital-gym-pro-media-manifest.json'), 'utf8'))
let cursor = 0
const uploadFailures = []

async function uploadNext() {
  while (cursor < manifest.files.length) {
    const file = manifest.files[cursor++]
    const body = await readFile(join(mediaDir, file.path))
    const contentType = file.path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
    const { error } = await bucket.upload(`vital-pro/${file.path}`, body, {
      cacheControl: '31536000',
      contentType,
      upsert: true,
    })
    if (error) uploadFailures.push(`${file.path}: ${error.message}`)
  }
}

await Promise.all(Array.from({ length: 12 }, uploadNext))
if (uploadFailures.length > 0) {
  throw new Error(`Upload failed for ${uploadFailures.length} files:\n${uploadFailures.slice(0, 20).join('\n')}`)
}

cursor = 0
const verifyFailures = []
async function verifyNext() {
  while (cursor < manifest.files.length) {
    const file = manifest.files[cursor++]
    const { data, error } = await bucket.download(`vital-pro/${file.path}`)
    if (error || !data) {
      verifyFailures.push(`${file.path}: ${error?.message ?? 'empty response'}`)
      continue
    }
    const body = Buffer.from(await data.arrayBuffer())
    const digest = createHash('sha256').update(body).digest('hex')
    if (body.length !== file.bytes || digest !== file.sha256) {
      verifyFailures.push(`${file.path}: remote content does not match the reviewed manifest`)
    }
  }
}

await Promise.all(Array.from({ length: 12 }, verifyNext))
if (verifyFailures.length > 0) {
  throw new Error(`Verification failed for ${verifyFailures.length} files:\n${verifyFailures.slice(0, 20).join('\n')}`)
}
console.log(`Uploaded and verified ${manifest.files.length} private Vital media files.`)
