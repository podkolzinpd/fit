import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)
const typeFile = new URL('../src/data/database.types.ts', import.meta.url)
const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
const hash = createHash('sha256')
for (const name of names) hash.update(name).update('\0').update(await readFile(new URL(name, migrationsDirectory))).update('\0')
const expected = hash.digest('hex')
const source = await readFile(typeFile, 'utf8')
const actual = source.match(/^\/\/ schema-sha256: ([a-f0-9]{64})$/m)?.[1]

if (process.argv.includes('--print')) console.log(expected)
else if (actual !== expected) {
  console.error('database.types.ts устарел: обновите типы и schema-sha256 после миграции.')
  process.exitCode = 1
}
