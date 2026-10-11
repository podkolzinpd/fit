import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRelease } from './frontend-release.mjs'
import { limeFonts, prepareFitLimeFonts } from './prepare-fit-lime-fonts.mjs'

const repository = 'podkolzinpd/fit'
const workflow = '.github/workflows/deploy-yandex-frontend.yml'
export function selectPublishedFrontendRun(runs) {
  const run = runs.find(run => run.path === workflow && run.head_branch === 'main'
    && run.head_repository?.full_name === repository && run.status === 'completed'
    && run.conclusion === 'success' && /^[a-f0-9]{40}$/.test(run.head_sha)
    && Number.isSafeInteger(run.id) && run.id > 0)
  if (!run) throw new Error('No verified published frontend release available')
  return run
}

export function publishedFontEnvironment(bundle, expectedCommit, fonts = limeFonts) {
  verifyRelease(bundle)
  if (bundle.commit !== expectedCommit) throw new Error('Published frontend commit mismatch')
  const env = { FIT_LIME_FONTS_REQUIRED: 'true' }
  for (const font of fonts) {
    const file = bundle.files.find(file => file.key === `fonts/${font.name}`)
    if (!file || file.contentType !== 'font/woff2' || file.sha256 !== font.sha256) {
      throw new Error('Approved published font missing or changed')
    }
    env[font.env + '_PART1'] = file.content
  }
  return env
}

// Only already-published public assets. No production secrets, source trees,
// unpublished candidates or other users' data are read or exported.
export function prepareFitLimePublishedFonts({ directory = 'public/fonts' } = {}) {
  const gh = args => {
    try { return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { throw new Error('Published frontend artifact retrieval failed') }
  }
  const runs = JSON.parse(gh(['api', `repos/${repository}/actions/workflows/deploy-yandex-frontend.yml/runs?per_page=20`])).workflow_runs
  const run = selectPublishedFrontendRun(runs)
  const artifacts = JSON.parse(gh(['api', `repos/${repository}/actions/runs/${run.id}/artifacts`])).artifacts
    .filter(a => a.name === 'yandex-frontend-release' && a.expired === false)
  if (artifacts.length !== 1 || artifacts[0].size_in_bytes > 100 * 1024 * 1024) throw new Error('Published frontend artifact unavailable')
  const temporary = mkdtempSync(join(tmpdir(), 'fit-published-fonts-'))
  try {
    gh(['run', 'download', String(run.id), '--repo', repository, '--name', 'yandex-frontend-release', '--dir', temporary])
    const bundle = JSON.parse(readFileSync(join(temporary, 'frontend-release.json'), 'utf8'))
    const env = publishedFontEnvironment(bundle, run.head_sha)
    const names = prepareFitLimeFonts({ directory, env })
    console.log(`Verified public webfonts from published release ${run.head_sha}: ${names.length}/${limeFonts.length}`)
    return names
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
