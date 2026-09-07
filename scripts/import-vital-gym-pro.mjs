#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const catalogPath = join(projectRoot, 'scripts/data/vital-gym-pro-catalog.json')
const outputDir = join(projectRoot, 'public/exercises/vital-pro')
const generatedPath = join(projectRoot, 'src/shared/vital-gym-pro.generated.ts')
const manifestPath = join(projectRoot, 'scripts/data/vital-gym-pro-media-manifest.json')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const sourceDir = resolve(argument('--source', ''))
const workers = Math.max(1, Number(argument('--workers', Math.min(4, cpus().length))) || 1)
const skipMedia = process.argv.includes('--skip-media')
if (!argument('--source')) {
  console.error('Usage: node scripts/import-vital-gym-pro.mjs --source /path/to/extracted/archive [--workers 4]')
  process.exit(2)
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolveRun()
      : reject(new Error(`${command} exited with ${code}: ${error.slice(-1200)}`)))
  })
}

async function probeDuration(path) {
  return new Promise((resolveProbe, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path])
    let output = ''
    let error = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      const duration = Number(output.trim())
      if (code !== 0 || !Number.isFinite(duration) || duration <= 0) reject(new Error(`Unable to probe ${path}: ${error}`))
      else resolveProbe(duration)
    })
  })
}

async function probeOutput(path) {
  return new Promise((resolveProbe, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration',
      '-of', 'json',
      path,
    ])
    let output = ''
    let error = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Unable to probe ${path}: ${error}`))
      try {
        resolveProbe(JSON.parse(output))
      } catch (parseError) {
        reject(new Error(`Invalid ffprobe output for ${path}: ${parseError.message}`))
      }
    })
  })
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
if (catalog.version !== 1 || catalog.exercises.length !== 317) {
  throw new Error(`Unexpected reviewed catalog: version=${catalog.version}, exercises=${catalog.exercises.length}`)
}
if (new Set(catalog.exercises.map(({ ref }) => ref)).size !== catalog.exercises.length) throw new Error('Duplicate FIT refs')
if (new Set(catalog.exercises.map(({ purchasedId }) => purchasedId)).size !== catalog.exercises.length) throw new Error('Duplicate purchased ids')

for (const exercise of catalog.exercises) {
  const sourcePath = join(sourceDir, exercise.sourceFile)
  const sourceStat = await stat(sourcePath).catch(() => null)
  if (!sourceStat?.isFile()) throw new Error(`Missing purchased source: ${exercise.purchasedId} ${exercise.sourceFile}`)
}

await mkdir(outputDir, { recursive: true })
const videoFilter = 'fps=30,scale=w=540:h=540:force_original_aspect_ratio=decrease,pad=540:540:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1'
let cursor = 0
let complete = 0

async function encodeWorker() {
  while (cursor < catalog.exercises.length) {
    const exercise = catalog.exercises[cursor++]
    const sourcePath = join(sourceDir, exercise.sourceFile)
    const videoPath = join(outputDir, `${exercise.ref}.mp4`)
    const posterPath = join(outputDir, `${exercise.ref}.jpg`)
    const endPath = join(outputDir, `${exercise.ref}-end.jpg`)
    const duration = await probeDuration(sourcePath)
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
      '-an', '-vf', videoFilter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '29',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
    ])
    for (const [seconds, target] of [[Math.min(0.1, duration / 4), posterPath], [duration / 2, endPath]]) {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(seconds), '-i', videoPath,
        '-frames:v', '1', '-q:v', '4', target,
      ])
    }
    complete += 1
    process.stdout.write(`\rEncoded ${complete}/${catalog.exercises.length}`)
  }
}

if (!skipMedia) {
  await Promise.all(Array.from({ length: workers }, () => encodeWorker()))
  process.stdout.write('\n')
}

const instructions = [
  'Примите устойчивое исходное положение, показанное на анимации.',
  'Выполняйте движение плавно и подконтрольно, сохраняя нейтральное положение корпуса.',
  'Вернитесь в исходное положение без рывка.',
]
const mediaFor = (exercise) => ({
  imageUrl: `/exercises/vital-pro/${exercise.ref}.jpg`,
  motionImageUrl: `/exercises/vital-pro/${exercise.ref}-end.jpg`,
  techniqueVideoUrl: `/exercises/vital-pro/${exercise.ref}.mp4`,
})
const preferredLegacyRef = (exercise) => exercise.legacyFitRefs.find((ref) => !/^(?:fedb|vital)-/u.test(ref)) ?? exercise.legacyFitRefs[0]
const mainRefs = catalog.exercises.map((exercise) => preferredLegacyRef(exercise) ?? exercise.ref)
if (new Set(mainRefs).size !== catalog.exercises.length) throw new Error('Two reviewed movements resolve to the same main FIT ref')
const exercises = catalog.exercises.filter((exercise) => exercise.legacyFitRefs.length === 0).map((exercise) => ({
  source: 'system',
  ref: exercise.ref,
  name: exercise.name,
  muscleGroup: exercise.muscleGroup,
  inputKind: exercise.inputKind,
  equipment: exercise.equipment,
  primaryMuscleDetail: exercise.primaryMuscleDetail,
  ...mediaFor(exercise),
  instructions,
}))
const assets = Object.fromEntries(catalog.exercises.map((exercise) => [exercise.ref, {
  publicVitalId: exercise.publicVitalId,
  purchasedId: exercise.purchasedId,
  purchasedName: exercise.purchasedName,
}]))
const aliases = Object.fromEntries(catalog.exercises.filter((exercise) => exercise.legacyFitRefs.length === 0).map((exercise) => [exercise.ref, [exercise.englishName, ...exercise.aliases]]))
const legacyRoots = Object.fromEntries(catalog.exercises.flatMap((exercise) => exercise.legacyFitRefs.map((ref) => [ref, preferredLegacyRef(exercise)])))
const mediaByLegacyRef = Object.fromEntries(catalog.exercises.flatMap((exercise) => exercise.legacyFitRefs.map((ref) => [ref, mediaFor(exercise)])))
const mainRefCandidates = catalog.exercises.map((exercise) => exercise.legacyFitRefs.length ? exercise.legacyFitRefs : [exercise.ref])
const generated = `// Generated by scripts/import-vital-gym-pro.mjs. Do not edit manually.\n` +
  `import type { ExerciseSnapshot } from './domain'\n\n` +
  `export const VITAL_GYM_PRO_NEW_EXERCISES = ${JSON.stringify(exercises, null, 2)} as const satisfies readonly ExerciseSnapshot[]\n\n` +
  `export const VITAL_GYM_PRO_ASSETS = ${JSON.stringify(assets, null, 2)} as const\n\n` +
  `export const VITAL_GYM_PRO_ALIASES_BY_REF: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(aliases, null, 2)}\n\n` +
  `export const VITAL_GYM_PRO_LEGACY_ROOT_BY_REF: Readonly<Record<string, string>> = ${JSON.stringify(legacyRoots, null, 2)}\n\n` +
  `export const VITAL_GYM_PRO_MEDIA_BY_LEGACY_REF: Readonly<Record<string, { imageUrl: string; motionImageUrl: string; techniqueVideoUrl: string }>> = ${JSON.stringify(mediaByLegacyRef, null, 2)}\n\n` +
  `export const VITAL_GYM_PRO_MAIN_REFS = ${JSON.stringify(mainRefs, null, 2)} as const\n\n` +
  `export const VITAL_GYM_PRO_MAIN_REF_CANDIDATES = ${JSON.stringify(mainRefCandidates, null, 2)} as const\n\n` +
  `export const VITAL_GYM_PRO_EXCLUDED_PUBLIC_IDS = ${JSON.stringify(catalog.excludedPublicVitalIds, null, 2)} as const\n\n` +
  `export const VITAL_GYM_PRO_REFS: ReadonlySet<string> = new Set(VITAL_GYM_PRO_MAIN_REFS)\n`
await mkdir(dirname(generatedPath), { recursive: true })
await writeFile(generatedPath, generated)

const manifestFiles = []
for (const exercise of catalog.exercises) {
  const media = mediaFor(exercise)
  for (const relativePath of [media.imageUrl, media.motionImageUrl, media.techniqueVideoUrl]) {
    const outputPath = join(projectRoot, 'public', relativePath.replace(/^\//, ''))
    const outputStat = await stat(outputPath)
    if (!outputStat.isFile() || outputStat.size === 0) throw new Error(`Invalid output: ${relativePath}`)
    const contents = await readFile(outputPath)
    manifestFiles.push({
      path: relativePath.replace('/exercises/vital-pro/', ''),
      bytes: outputStat.size,
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
  }
  const videoPath = join(projectRoot, 'public', media.techniqueVideoUrl.replace(/^\//, ''))
  const probe = await probeOutput(videoPath)
  const video = probe.streams?.find(({ codec_type: codecType }) => codecType === 'video')
  const hasAudio = probe.streams?.some(({ codec_type: codecType }) => codecType === 'audio')
  if (video?.codec_name !== 'h264' || video.width !== 540 || video.height !== 540 || video.r_frame_rate !== '30/1' || hasAudio || !(Number(probe.format?.duration) > 0)) {
    throw new Error(`Unexpected video format: ${media.techniqueVideoUrl}`)
  }
}
await writeFile(manifestPath, `${JSON.stringify({ version: 1, exerciseCount: catalog.exercises.length, files: manifestFiles }, null, 2)}\n`)
console.log(`Generated ${catalog.exercises.length} reviewed movements: ${exercises.length} new exercises and ${catalog.exercises.length - exercises.length} existing FIT identities.`)
