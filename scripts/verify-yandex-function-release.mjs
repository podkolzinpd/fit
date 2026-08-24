import { execFileSync } from 'node:child_process'
import process from 'node:process'

const DEFAULT_ATTEMPTS = 8
const DEFAULT_DELAY_MS = 2_000

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must not be empty`)
  }
  return value.trim()
}

function asJson(value, description) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${description} returned invalid JSON`)
  }
}

function defaultYc(arguments_) {
  return execFileSync('yc', arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function latestVersionArguments(functionName, folderId) {
  return [
    'serverless', 'function', 'version', 'get-by-tag',
    '--function-name', functionName,
    '--folder-id', folderId,
    '--tag', '$latest',
    '--format', 'json',
  ]
}

function functionArguments(functionName, folderId) {
  return [
    'serverless', 'function', 'get',
    '--name', functionName,
    '--folder-id', folderId,
    '--format', 'json',
  ]
}

function rollbackArguments(previousVersionId, folderId) {
  return [
    'serverless', 'function', 'version', 'set-tag',
    '--id', previousVersionId,
    '--folder-id', folderId,
    '--tag', '$latest',
  ]
}

async function smokeAuthenticationGate(url, attempts, delayMs, fetch_, sleep) {
  let lastFailure = 'request did not run'

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch_(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (response.status === 401) return
      lastFailure = `HTTP ${response.status}`
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : 'network error'
    }

    if (attempt < attempts) await sleep(delayMs)
  }

  throw new Error(`authentication smoke failed after ${attempts} attempts: ${lastFailure}`)
}

export async function verifyYandexFunctionRelease(input, dependencies = {}) {
  const functionName = requireText(input.functionName, 'functionName')
  const folderId = requireText(input.folderId, 'folderId')
  const expectedVersionId = requireText(input.expectedVersionId, 'expectedVersionId')
  const previousVersionId = input.previousVersionId?.trim() ?? ''
  const attempts = input.attempts ?? DEFAULT_ATTEMPTS
  const delayMs = input.delayMs ?? DEFAULT_DELAY_MS
  const yc = dependencies.yc ?? defaultYc
  const fetch_ = dependencies.fetch ?? globalThis.fetch
  const sleep = dependencies.sleep ?? defaultSleep

  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be a positive integer')
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error('delayMs must be a non-negative integer')
  if (typeof fetch_ !== 'function') throw new Error('fetch is unavailable')

  let releaseFailure
  try {
    const latest = asJson(yc(latestVersionArguments(functionName, folderId)), 'latest version lookup')
    if (latest.id !== expectedVersionId) {
      throw new Error(`$latest points to ${String(latest.id)}, expected ${expectedVersionId}`)
    }
    if (latest.status !== 'ACTIVE') {
      throw new Error(`version ${expectedVersionId} is ${String(latest.status)}, expected ACTIVE`)
    }

    const function_ = asJson(yc(functionArguments(functionName, folderId)), 'function lookup')
    const functionUrl = requireText(function_.http_invoke_url, 'http_invoke_url')
    await smokeAuthenticationGate(functionUrl, attempts, delayMs, fetch_, sleep)
    return { functionUrl, versionId: expectedVersionId, rolledBack: false }
  } catch (error) {
    releaseFailure = error instanceof Error ? error : new Error(String(error))
  }

  if (previousVersionId === '' || previousVersionId === expectedVersionId) {
    throw new Error(`${releaseFailure.message}; no previous version is available for rollback`)
  }

  try {
    yc(rollbackArguments(previousVersionId, folderId))
    const restored = asJson(yc(latestVersionArguments(functionName, folderId)), 'rollback verification')
    if (restored.id !== previousVersionId || restored.status !== 'ACTIVE') {
      throw new Error(`$latest was not restored to active version ${previousVersionId}`)
    }
  } catch (rollbackError) {
    const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
    throw new Error(`${releaseFailure.message}; rollback failed: ${rollbackMessage}`)
  }

  throw new Error(`${releaseFailure.message}; rolled back to ${previousVersionId}`)
}

function parseArguments(arguments_) {
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index]
    const value = arguments_[index + 1]
    if (!key?.startsWith('--') || value === undefined) throw new Error(`invalid argument near ${String(key)}`)
    values.set(key.slice(2), value)
  }
  return {
    functionName: values.get('function-name'),
    folderId: values.get('folder-id'),
    expectedVersionId: values.get('expected-version-id'),
    previousVersionId: values.get('previous-version-id'),
  }
}

const invokedDirectly = process.argv[1] !== undefined
  && new URL(import.meta.url).pathname === process.argv[1]

if (invokedDirectly) {
  try {
    const result = await verifyYandexFunctionRelease(parseArguments(process.argv.slice(2)))
    console.log(`Verified Yandex Function version ${result.versionId}: ${result.functionUrl}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
