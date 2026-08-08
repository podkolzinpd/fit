import { readFile } from 'node:fs/promises'

const infoPlist = await readFile(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8')
const requiredKeys = ['NSMicrophoneUsageDescription']
const missingKeys = requiredKeys.filter((key) => {
  const entry = new RegExp(`<key>${key}</key>\\s*<string>[^<]+</string>`)
  return !entry.test(infoPlist)
})

if (missingKeys.length > 0) {
  console.error(`Info.plist не содержит обязательные privacy-ключи: ${missingKeys.join(', ')}.`)
  process.exitCode = 1
}
