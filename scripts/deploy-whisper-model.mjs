#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const projectRef = process.env.SUPABASE_PROJECT_ID?.trim()
const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim()
if (!projectRef || !accessToken) throw new Error('Supabase deployment credentials are required')

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'src/features/voice-input/whisper-model-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

const sourceResponse = await fetch(manifest.sourceUrl)
if (!sourceResponse.ok) throw new Error(`Could not download the pinned speech model: HTTP ${sourceResponse.status}`)
const model = Buffer.from(await sourceResponse.arrayBuffer())
verifyModel(model, 'Downloaded source')

const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!keysResponse.ok) throw new Error(`Could not obtain the project deployment key: HTTP ${keysResponse.status}`)
const keys = await keysResponse.json()
const deploymentKey = keys.find((key) => key.type === 'secret')?.api_key
  ?? keys.find((key) => key.name === 'service_role')?.api_key
if (!deploymentKey) throw new Error('No server-side Supabase deployment key is available')

const projectUrl = `https://${projectRef}.supabase.co`
const supabase = createClient(projectUrl, deploymentKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: buckets, error: listError } = await supabase.storage.listBuckets()
if (listError) throw new Error(`Could not inspect the speech model bucket: ${listError.message}`)

const bucketOptions = {
  public: true,
  allowedMimeTypes: ['application/octet-stream'],
  fileSizeLimit: 64 * 1024 * 1024,
}
if (buckets.some(({ id }) => id === manifest.bucket)) {
  const { error } = await supabase.storage.updateBucket(manifest.bucket, bucketOptions)
  if (error) throw new Error(`Could not configure the speech model bucket: ${error.message}`)
} else {
  const { error } = await supabase.storage.createBucket(manifest.bucket, bucketOptions)
  if (error) throw new Error(`Could not create the speech model bucket: ${error.message}`)
}

const { error: uploadError } = await supabase.storage.from(manifest.bucket).upload(manifest.path, model, {
  cacheControl: '31536000',
  contentType: 'application/octet-stream',
  upsert: true,
})
if (uploadError) throw new Error(`Could not upload the speech model: ${uploadError.message}`)

const publicUrl = `${projectUrl}/storage/v1/object/public/${manifest.bucket}/${manifest.path}`
const verifyResponse = await fetch(publicUrl, {
  headers: { Origin: 'https://fit-drab.vercel.app' },
})
if (!verifyResponse.ok) throw new Error(`Could not read the public speech model: HTTP ${verifyResponse.status}`)
const allowedOrigin = verifyResponse.headers.get('access-control-allow-origin')
if (allowedOrigin !== '*' && allowedOrigin !== 'https://fit-drab.vercel.app') {
  throw new Error('The public speech model response does not allow the Fit production origin')
}
verifyModel(Buffer.from(await verifyResponse.arrayBuffer()), 'Uploaded model')
console.log(`Uploaded and verified the pinned public speech model: ${publicUrl}`)

function verifyModel(body, label) {
  const digest = createHash('sha256').update(body).digest('hex')
  if (body.length !== manifest.bytes || digest !== manifest.sha256) {
    throw new Error(`${label} does not match the reviewed manifest`)
  }
}
