#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const sourceArgument = argument('--source')
const auditArgument = argument('--audit')
if (!sourceArgument || !auditArgument) {
  console.error('Usage: node scripts/render-vital-gym-pro-review.mjs --source /path/to/archive --audit /path/to/audit.json [--output /path/to/review] [--equipment "body weight"]')
  process.exit(2)
}

const sourceDir = resolve(sourceArgument)
const auditPath = resolve(auditArgument)
const outputDir = resolve(argument('--output', 'artifacts/vital-gym-pro-review'))
const equipment = argument('--equipment')
const workers = Math.max(1, Number(argument('--workers', '6')) || 1)

function run(command, args, captureOutput = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', captureOutput ? 'pipe' : 'ignore', 'pipe'] })
    let output = ''
    let error = ''
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolveRun(output)
      : reject(new Error(`${command} exited with ${code}: ${error.slice(-1200)}`)))
  })
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const audit = JSON.parse(await readFile(auditPath, 'utf8'))
const rows = audit.remaining.filter((row) => !equipment || row.equipment === equipment)
await mkdir(join(outputDir, 'frames'), { recursive: true })

let cursor = 0
let complete = 0
const frameRows = new Array(rows.length)

async function renderWorker() {
  while (cursor < rows.length) {
    const index = cursor++
    const row = rows[index]
    const input = join(sourceDir, row.sourceFile)
    const duration = Number((await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', input,
    ], true)).trim())
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid duration: ${row.sourceFile}`)
    const outputName = `${String(index + 1).padStart(4, '0')}-${row.id || basename(row.sourceFile)}.jpg`
    const output = join(outputDir, 'frames', outputName)
    const times = [0.12, 0.5, 0.88].map((ratio) => String(Math.max(0, duration * ratio)))
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', times[0], '-i', input,
      '-ss', times[1], '-i', input,
      '-ss', times[2], '-i', input,
      '-filter_complex',
      '[0:v]scale=180:180:force_original_aspect_ratio=decrease,pad=180:180:(ow-iw)/2:(oh-ih)/2:color=white[a];' +
      '[1:v]scale=180:180:force_original_aspect_ratio=decrease,pad=180:180:(ow-iw)/2:(oh-ih)/2:color=white[b];' +
      '[2:v]scale=180:180:force_original_aspect_ratio=decrease,pad=180:180:(ow-iw)/2:(oh-ih)/2:color=white[c];' +
      '[a][b][c]hstack=inputs=3[out]',
      '-map', '[out]', '-frames:v', '1', '-q:v', '3', output,
    ])
    frameRows[index] = { ...row, frame: `frames/${outputName}`, duration }
    complete += 1
    process.stdout.write(`\rRendered ${complete}/${rows.length}`)
  }
}

await Promise.all(Array.from({ length: Math.min(workers, rows.length || 1) }, () => renderWorker()))
process.stdout.write('\n')

const equipmentOptions = [...new Set(frameRows.map((row) => row.equipment))].sort()
const categoryOptions = [...new Set(frameRows.map((row) => row.category))].sort()
const cards = frameRows.map((row) => `<article class="card" data-equipment="${escapeHtml(row.equipment)}" data-category="${escapeHtml(row.category)}" data-search="${escapeHtml(`${row.id} ${row.name} ${row.sourceFile}`.toLocaleLowerCase('en'))}">
  <img src="${escapeHtml(row.frame)}" alt="${escapeHtml(row.name)}" loading="lazy">
  <div><strong>${escapeHtml(row.id)} · ${escapeHtml(row.name || 'Без метаданных')}</strong><span>${escapeHtml(row.category)} · ${escapeHtml(row.equipment)} · ${escapeHtml(row.bodyPart)} / ${escapeHtml(row.target)} · ${row.duration.toFixed(2)} c</span><small>${escapeHtml(row.sourceFile)}</small></div>
</article>`).join('\n')
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vital Gym Pro review</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#242426;background:#f3f1ec}*{box-sizing:border-box}body{margin:0}.toolbar{position:sticky;top:0;z-index:2;display:flex;gap:12px;padding:14px 20px;background:#fbfaf7;border-bottom:1px solid #dedbd4}.toolbar input,.toolbar select{height:42px;padding:0 12px;border:1px solid #c9c6c0;border-radius:10px;background:white;font-size:15px}.toolbar input{flex:1}.count{align-self:center;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px 20px}.card{display:grid;grid-template-columns:270px 1fr;gap:12px;min-width:0;padding:10px;background:#fbfaf7;border:1px solid #dedbd4;border-radius:14px}.card[hidden]{display:none}.card img{display:block;width:270px;height:90px;object-fit:contain;background:white}.card div{min-width:0}.card strong,.card span,.card small{display:block}.card strong{font-size:14px;line-height:1.25}.card span{margin-top:6px;color:#666560;font-size:12px}.card small{margin-top:5px;overflow-wrap:anywhere;color:#74736f;font-size:10px}@media(max-width:900px){.grid{grid-template-columns:1fr}.card{grid-template-columns:240px 1fr}.card img{width:240px;height:80px}}
</style></head><body><div class="toolbar"><input id="search" placeholder="ID, название или путь"><select id="category"><option value="">Все категории</option>${categoryOptions.map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select><select id="equipment"><option value="">Всё оборудование</option>${equipmentOptions.map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select><span class="count" id="count"></span></div><main class="grid">${cards}</main><script>
const cards=[...document.querySelectorAll('.card')],search=document.querySelector('#search'),category=document.querySelector('#category'),equipment=document.querySelector('#equipment'),count=document.querySelector('#count');function apply(){const q=search.value.toLocaleLowerCase('en').trim();let visible=0;for(const card of cards){const show=(!q||card.dataset.search.includes(q))&&(!category.value||card.dataset.category===category.value)&&(!equipment.value||card.dataset.equipment===equipment.value);card.hidden=!show;if(show)visible++}count.textContent=visible+' / '+cards.length}search.addEventListener('input',apply);category.addEventListener('change',apply);equipment.addEventListener('change',apply);apply();
</script></body></html>`

await writeFile(join(outputDir, 'index.html'), html)
await writeFile(join(outputDir, 'review.json'), `${JSON.stringify(frameRows, null, 2)}\n`)
console.log(`Review: ${join(outputDir, 'index.html')}`)
