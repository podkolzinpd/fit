import { createHash, createPublicKey } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
export function androidOtaPolicy(root = projectRoot, env = process.env) {
  const publicKey = readFileSync(resolve(root, 'config/android-ota-public-key.pem'), 'utf8')
  if (createPublicKey(publicKey).asymmetricKeyType !== 'rsa') throw new Error('OTA requires an RSA public key')
  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
  // Conservative: every locked dependency is part of compatibility. This also
  // covers native plugins under unknown scopes; a dependency upgrade needs an APK.
  const nativeDependencies = Object.entries(lock.packages).filter(([name]) => name.startsWith('node_modules/'))
    .map(([name, entry]) => [name, entry.version, entry.integrity]).sort()
  const hash = createHash('sha256').update(JSON.stringify(nativeDependencies))
  // Generated sync outputs and machine-specific files cannot describe an ABI.
  const excluded = new Set(['build', '.gradle', '.idea', 'capacitor-cordova-android-plugins'])
  const generated = new Set(['local.properties', 'capacitor.settings.gradle', 'capacitor.build.gradle'])
  function visit(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (excluded.has(item.name) || generated.has(item.name)) continue
      const path = resolve(directory, item.name)
      if (['android/app/src/main/assets', 'android/app/src/main/res/xml/config.xml', 'android/app/src/test', 'android/app/src/androidTest'].includes(relative(root, path).replaceAll('\\', '/'))) continue
      if (item.isSymbolicLink()) throw new Error('OTA native contract cannot contain symlinks')
      if (item.isDirectory()) visit(path)
      else hash.update(relative(root, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0')
    }
  }
  visit(resolve(root, 'android'))
  for (const name of ['capacitor.config.ts', 'config/android-ota-public-key.pem']) hash.update(name).update(readFileSync(resolve(root, name)))
  return { enabled: env.FIT_ANDROID_OTA_ENABLED === 'true', abi: hash.digest('hex'), publicKey,
    appId: 'com.coachspace.fit', origin: 'https://fit-training.ru', channel: 'alpha' }
}
