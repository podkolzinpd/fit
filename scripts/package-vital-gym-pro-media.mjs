#!/usr/bin/env node

import { createCipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const MAGIC = Buffer.from('FITVITAL1')
const projectRoot = resolve(import.meta.dirname, '..')
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const sourceDir = resolve(argument('--source', join(projectRoot, 'public/exercises/vital-pro')))
const outputPath = resolve(argument('--output', join(projectRoot, 'scripts/data/vital-gym-pro-media.enc')))
const keyFile = argument('--key-file')
if (!keyFile) throw new Error('Usage: node scripts/package-vital-gym-pro-media.mjs --key-file /secure/path/key [--source /path]')

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${code}: ${error.slice(-1000)}`)))
  })
}

const key = Buffer.from((await readFile(resolve(keyFile), 'utf8')).trim(), 'base64')
if (key.length !== 32) throw new Error('The media key must contain exactly 32 random bytes encoded as base64')
if (!(await stat(sourceDir)).isDirectory()) throw new Error(`Media source is not a directory: ${sourceDir}`)

const temporaryDir = await mkdtemp(join(tmpdir(), 'fit-vital-media-'))
const tarPath = join(temporaryDir, 'media.tar')
try {
  await run('tar', ['-C', sourceDir, '-cf', tarPath, '.'])
  const plaintext = await readFile(tarPath)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  await writeFile(outputPath, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]))
  console.log(`Packaged authenticated Gym Pro media: ${Math.round(ciphertext.length / 1024 / 1024)} MB.`)
} finally {
  await rm(temporaryDir, { recursive: true, force: true })
}
