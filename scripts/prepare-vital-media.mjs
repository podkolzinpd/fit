#!/usr/bin/env node

import { createDecipheriv, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const MAGIC = Buffer.from('FITVITAL1')
const projectRoot = resolve(import.meta.dirname, '..')
const encryptedPath = join(projectRoot, 'scripts/data/vital-gym-pro-media.enc')
const manifestPath = join(projectRoot, 'scripts/data/vital-gym-pro-media-manifest.json')
const outputDir = join(projectRoot, 'public/exercises/vital-pro')

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}: ${error.slice(-1000)}`)))
  })
}

async function validateMedia(manifest) {
  const actualNames = (await readdir(outputDir)).sort()
  const expectedNames = manifest.files.map(({ path }) => path).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) return false
  for (const file of manifest.files) {
    const filePath = join(outputDir, file.path)
    const fileStat = await stat(filePath).catch(() => null)
    if (!fileStat?.isFile() || fileStat.size !== file.bytes) return false
    const digest = createHash('sha256').update(await readFile(filePath)).digest('hex')
    if (digest !== file.sha256) return false
  }
  return true
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
if (manifest.version !== 1 || manifest.exerciseCount !== 317 || manifest.files.length !== 951) {
  throw new Error('Unexpected Gym Pro media manifest')
}
if (await validateMedia(manifest).catch(() => false)) {
  console.log('Gym Pro media is already prepared and verified.')
  process.exit(0)
}

const encodedKey = process.env.VITAL_MEDIA_KEY?.trim()
  ?? (process.env.VITAL_MEDIA_KEY_FILE ? (await readFile(resolve(process.env.VITAL_MEDIA_KEY_FILE), 'utf8')).trim() : undefined)
if (!encodedKey) {
  console.log('Gym Pro media is not prepared locally; deployed clients use private signed media URLs.')
  process.exit(0)
}
const key = Buffer.from(encodedKey, 'base64')
if (key.length !== 32) throw new Error('VITAL_MEDIA_KEY must decode to 32 bytes')

const encrypted = await readFile(encryptedPath)
const offset = MAGIC.length
if (!encrypted.subarray(0, offset).equals(MAGIC)) throw new Error('Unexpected encrypted Gym Pro media format')
const iv = encrypted.subarray(offset, offset + 12)
const tag = encrypted.subarray(offset + 12, offset + 28)
const ciphertext = encrypted.subarray(offset + 28)
const decipher = createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

const temporaryDir = await mkdtemp(join(tmpdir(), 'fit-vital-build-'))
const tarPath = join(temporaryDir, 'media.tar')
try {
  await writeFile(tarPath, plaintext)
  await rm(outputDir, { recursive: true, force: true })
  await mkdir(outputDir, { recursive: true })
  await run('tar', ['-xf', tarPath, '-C', outputDir])
  if (!(await validateMedia(manifest))) throw new Error('Decrypted Gym Pro media does not match the reviewed manifest')
  console.log('Prepared and verified 317 Gym Pro videos for this build.')
} finally {
  await rm(temporaryDir, { recursive: true, force: true })
}
