#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import batchOne from './data/vital-gym-pro-catalog-batch-1.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const catalogPath = join(projectRoot, 'scripts/data/vital-gym-pro-catalog.json')

const collections = [
  {
    name: '100 Gym Workouts',
    metadata: '100 Gym Workouts/100gymworkouts.json',
    media: '100 Gym Workouts/100gymworkouts',
  },
  {
    name: '100 Workouts',
    metadata: '100 Workouts/100workouts.json',
    media: '100 Workouts/100 Workouts',
  },
  {
    name: '200 Workouts',
    metadata: '200 Workouts/200workouts.json',
    media: '200 Workouts/200 Workouts',
  },
  {
    name: '100 Female Gym Workouts',
    metadata: '430 Workouts/430 Workouts/100femalegym.json',
    media: '430 Workouts/430 Workouts/100 female Gym',
  },
  {
    name: '130 Male Gym Workouts',
    metadata: '430 Workouts/430 Workouts/130malegym.json',
    media: '430 Workouts/430 Workouts/130 male gym',
  },
  {
    name: '200 Female Gym Workouts',
    metadata: '430 Workouts/430 Workouts/200femalegym.json',
    media: '430 Workouts/430 Workouts/200 female gym',
  },
]

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const sourceArgument = argument('--source')
if (!sourceArgument) {
  console.error('Usage: node scripts/audit-vital-gym-pro.mjs --source /path/to/extracted/archive [--output /path/to/report.json]')
  process.exit(2)
}

const sourceDir = resolve(sourceArgument)
const outputPath = resolve(argument('--output', join(projectRoot, 'artifacts/vital-gym-pro-audit.json')))

async function listFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else files.push(path)
  }
  return files
}

function countBy(rows, key) {
  const counts = new Map()
  for (const row of rows) {
    const value = row[key] || 'unknown'
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}

function normalizeName(value) {
  return value
    .toLocaleLowerCase('en')
    .replaceAll('&', 'and')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
}

const sourceRoot = await stat(sourceDir).catch(() => null)
if (!sourceRoot?.isDirectory()) throw new Error(`Source directory does not exist: ${sourceDir}`)

const baseCatalog = JSON.parse(await readFile(catalogPath, 'utf8'))
const catalog = { ...baseCatalog, exercises: [...baseCatalog.exercises, ...batchOne.exercises] }
const selectedSourceFiles = new Set(catalog.exercises.map(({ sourceFile }) => sourceFile))
const mediaFiles = (await listFiles(sourceDir))
  .filter((path) => /\.(?:mov|mp4)$/iu.test(path))
  .map((path) => relative(sourceDir, path))
  .sort()
const mediaSet = new Set(mediaFiles)
const metadataRows = []

for (const collection of collections) {
  const items = JSON.parse(await readFile(join(sourceDir, collection.metadata), 'utf8'))
  for (const item of items) {
    const mp4Source = `${collection.media}/${item.id}.mp4`
    const movSource = `${collection.media}/${item.id}.mov`
    metadataRows.push({
      collection: collection.name,
      id: item.id,
      name: item.name,
      bodyPart: item.bodyPart,
      target: item.target,
      equipment: item.equipment,
      category: item.category,
      difficulty: item.difficulty,
      sourceFile: mediaSet.has(mp4Source) ? mp4Source : mediaSet.has(movSource) ? movSource : mp4Source,
    })
  }
}

const metadataBySource = new Map(metadataRows.map((row) => [row.sourceFile, row]))
const missingMedia = metadataRows.filter((row) => !mediaSet.has(row.sourceFile))
const unindexedMedia = mediaFiles.filter((path) => !metadataBySource.has(path))
const connectedMedia = mediaFiles.filter((path) => selectedSourceFiles.has(path))
const remainingMedia = mediaFiles.filter((path) => !selectedSourceFiles.has(path))
const remaining = remainingMedia.map((sourceFile) => metadataBySource.get(sourceFile) ?? ({
  collection: 'unknown',
  id: sourceFile.split('/').at(-1)?.replace(/\.mp4$/u, '') ?? '',
  name: '',
  bodyPart: '',
  target: '',
  equipment: '',
  category: '',
  difficulty: '',
  sourceFile,
}))

const duplicateNameGroups = [...Map.groupBy(metadataRows, (row) => normalizeName(row.name))]
  .filter(([name, rows]) => name && rows.length > 1)
  .map(([normalizedName, rows]) => ({
    normalizedName,
    sources: rows.map(({ id, name, sourceFile }) => ({ id, name, sourceFile })),
  }))
  .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName))

const archiveHash = createHash('sha256')
for (const path of mediaFiles) {
  const file = await stat(join(sourceDir, path))
  archiveHash.update(path)
  archiveHash.update(String(file.size))
}

const report = {
  version: 1,
  inventoryFingerprint: archiveHash.digest('hex'),
  counts: {
    metadataRows: metadataRows.length,
    mediaFiles: mediaFiles.length,
    reviewedCatalogEntries: catalog.exercises.length,
    uniqueConnectedMedia: connectedMedia.length,
    sharedCatalogBindings: catalog.exercises.length - selectedSourceFiles.size,
    remainingMedia: remainingMedia.length,
    metadataWithoutMedia: missingMedia.length,
    mediaWithoutMetadata: unindexedMedia.length,
  },
  remainingByCollection: countBy(remaining, 'collection'),
  remainingByEquipment: countBy(remaining, 'equipment'),
  remainingByCategory: countBy(remaining, 'category'),
  missingMedia,
  unindexedMedia,
  duplicateNameGroups,
  remaining,
}

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ outputPath, ...report.counts }, null, 2))
