#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const outputPath = resolve(argument(
  '--output',
  join(projectRoot, 'src/shared/exercise-media-presentation.generated.json'),
))
const workers = Math.max(1, Number(argument('--workers', '6')) || 1)
const requirePrivate = process.argv.includes('--require-private')
const MEDIA_DIRECTORIES = [
  { folder: 'vital', path: join(projectRoot, 'public/exercises/vital') },
  { folder: 'vital-pro', path: join(projectRoot, 'public/exercises/vital-pro') },
  { folder: 'reference', path: join(projectRoot, 'public/exercises/reference') },
]

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const output = []
    let error = ''
    child.stdout.on('data', (chunk) => output.push(chunk))
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolveRun(Buffer.concat(output))
      : reject(new Error(`${command} exited with ${code}: ${error.slice(-1200)}`)))
  })
}

function parsePpm(buffer) {
  let cursor = 0
  const token = () => {
    while (cursor < buffer.length && /\s/u.test(String.fromCharCode(buffer[cursor]))) cursor += 1
    const start = cursor
    while (cursor < buffer.length && !/\s/u.test(String.fromCharCode(buffer[cursor]))) cursor += 1
    return buffer.toString('ascii', start, cursor)
  }
  if (token() !== 'P6') throw new Error('Unexpected ffmpeg image output')
  const width = Number(token())
  const height = Number(token())
  const max = Number(token())
  if (cursor < buffer.length && /\s/u.test(String.fromCharCode(buffer[cursor]))) cursor += 1
  if (!Number.isInteger(width) || !Number.isInteger(height) || max !== 255) {
    throw new Error('Invalid PPM header')
  }
  const pixels = buffer.subarray(cursor)
  if (pixels.length !== width * height * 3) throw new Error('Invalid PPM pixel payload')
  return { width, height, pixels }
}

function pixelAt(frame, x, y) {
  const offset = (y * frame.width + x) * 3
  return [frame.pixels[offset], frame.pixels[offset + 1], frame.pixels[offset + 2]]
}

function isPaleCanvas([red, green, blue]) {
  return red >= 232 && green >= 230 && blue >= 226 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 22
}

function edgeIsCanvas(frame, axis, index) {
  const length = axis === 'x' ? frame.height : frame.width
  let canvasPixels = 0
  for (let offset = 0; offset < length; offset += 1) {
    const pixel = axis === 'x' ? pixelAt(frame, index, offset) : pixelAt(frame, offset, index)
    if (isPaleCanvas(pixel)) canvasPixels += 1
  }
  return canvasPixels / length >= 0.985
}

function symmetricCanvasInsets(frame, axis) {
  const length = axis === 'x' ? frame.width : frame.height
  let start = 0
  let end = 0
  while (start < length / 2 && edgeIsCanvas(frame, axis, start)) start += 1
  while (end < length / 2 && edgeIsCanvas(frame, axis, length - 1 - end)) end += 1
  if (Math.min(start, end) < Math.max(2, Math.round(length * 0.008))) return [0, 0]
  if (Math.abs(start - end) > Math.max(3, Math.round(length * 0.025))) return [0, 0]
  if (start + end > length * 0.72) return [0, 0]
  return [start, end]
}

function median(values) {
  if (values.length === 0) return undefined
  values.sort((left, right) => left - right)
  return values[Math.floor(values.length / 2)]
}

function paleCanvasFraction(frame) {
  let pale = 0
  const pixels = frame.width * frame.height
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (isPaleCanvas(pixelAt(frame, x, y))) pale += 1
    }
  }
  return pale / pixels
}

function paleCanvasLuminance(frame) {
  const samples = []
  const stride = Math.max(1, Math.floor(Math.min(frame.width, frame.height) / 120))
  for (let y = 0; y < frame.height; y += stride) {
    for (let x = 0; x < frame.width; x += stride) {
      const [red, green, blue] = pixelAt(frame, x, y)
      if (!isPaleCanvas([red, green, blue])) continue
      samples.push(Math.round((red * 299 + green * 587 + blue * 114) / 1000))
    }
  }
  return Math.max(232, Math.min(250, median(samples) ?? 246))
}

function backdropLuminance(frame, crop) {
  const [top, right, bottom, left] = crop
  const xStart = Math.min(frame.width - 1, left + 2)
  const xEnd = Math.max(0, frame.width - right - 3)
  const yStart = Math.min(frame.height - 1, top + 2)
  const yEnd = Math.max(0, frame.height - bottom - 3)
  const samples = []
  const collect = (x, y) => {
    const [red, green, blue] = pixelAt(frame, x, y)
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue)
    const luminance = Math.round((red * 299 + green * 587 + blue * 114) / 1000)
    if (chroma <= 28 && luminance >= 55 && luminance <= 225) samples.push(luminance)
  }
  const strideX = Math.max(1, Math.floor((xEnd - xStart + 1) / 90))
  const strideY = Math.max(1, Math.floor((yEnd - yStart + 1) / 90))
  const thickness = 7
  for (let y = yStart; y <= yEnd; y += strideY) {
    for (let offset = 0; offset < thickness; offset += 1) {
      collect(Math.min(xEnd, xStart + offset), y)
      collect(Math.max(xStart, xEnd - offset), y)
    }
  }
  for (let x = xStart; x <= xEnd; x += strideX) {
    for (let offset = 0; offset < thickness; offset += 1) {
      collect(x, Math.min(yEnd, yStart + offset))
      collect(x, Math.max(yStart, yEnd - offset))
    }
  }
  return Math.max(96, Math.min(178, median(samples) ?? 136))
}

function roundPercent(pixels, dimension) {
  return Number(((pixels / dimension) * 100).toFixed(4))
}

async function analyze(file) {
  const [source, ppm] = await Promise.all([
    readFile(file.path),
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-i', file.path,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'ppm', 'pipe:1',
    ]),
  ])
  const frame = parsePpm(ppm)
  const mostlyPaleCanvas = paleCanvasFraction(frame) >= 0.55
  const [left, right] = mostlyPaleCanvas ? [0, 0] : symmetricCanvasInsets(frame, 'x')
  const [top, bottom] = mostlyPaleCanvas ? [0, 0] : symmetricCanvasInsets(frame, 'y')
  const crop = [top, right, bottom, left]
  const luminance = mostlyPaleCanvas ? paleCanvasLuminance(frame) : backdropLuminance(frame, crop)
  return [file.url, {
    crop: [
      roundPercent(top, frame.height),
      roundPercent(right, frame.width),
      roundPercent(bottom, frame.height),
      roundPercent(left, frame.width),
    ],
    backdrop: `rgb(${luminance} ${luminance} ${luminance})`,
    sha256: createHash('sha256').update(source).digest('hex'),
  }]
}

const files = []
for (const directory of MEDIA_DIRECTORIES) {
  const directoryStat = await stat(directory.path).catch(() => null)
  if (!directoryStat?.isDirectory()) {
    if (requirePrivate && directory.folder === 'vital-pro') throw new Error('Prepared Gym Pro media is required')
    continue
  }
  for (const name of (await readdir(directory.path)).sort()) {
    if (!name.endsWith('.jpg') || name.endsWith('-end.jpg')) continue
    files.push({
      path: join(directory.path, name),
      url: `/exercises/${directory.folder}/${name}`,
    })
  }
}

let cursor = 0
const entries = new Array(files.length)
async function worker() {
  while (cursor < files.length) {
    const index = cursor++
    entries[index] = await analyze(files[index])
  }
}
await Promise.all(Array.from({ length: Math.min(workers, files.length || 1) }, worker))

const payload = {
  version: 1,
  items: Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))),
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`Analyzed ${files.length} exercise posters into ${basename(outputPath)}.`)
