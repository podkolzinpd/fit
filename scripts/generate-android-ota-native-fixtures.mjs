// Throwaway test-only RSA key; no production key is read or written.
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
const directory = resolve('android/app/src/test/resources/ota')
const temporary = await mkdtemp(resolve(tmpdir(), 'fit-ota-native-fixture-'))
try {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  await writeFile(resolve(temporary, 'index.html'), '<!doctype html><html><body>OTA native fixture</body></html>')
  execFileSync('zip', ['-q', 'fixture.zip', 'index.html'], { cwd: temporary })
  const bytes = await readFile(resolve(temporary, 'fixture.zip'))
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'bundle.zip'), bytes)
  await writeFile(resolve(directory, 'metadata.json'), JSON.stringify({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    signature: sign('sha256', bytes, privateKey).toString('base64'),
  }))
  console.log('Generated Node-signed native fixtures with a disposable test key')
} finally { await rm(temporary, { recursive: true, force: true }) }
