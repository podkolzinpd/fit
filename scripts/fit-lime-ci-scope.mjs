import { createHash } from 'node:crypto'
import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { changedPaths, requiresE2E } from './e2e-scope.mjs'

// Owner-approved temporary PR policy, expiring at midnight Moscow time.
export const scopedPrExpiresAt = '2026-10-25T21:00:00.000Z'
export const scopedPrStartsAt = '2026-10-12T00:00:00.000Z'
// Any edit to the reviewed inventory/fixtures fails closed until re-audited.
export const reviewedInventoryDigest = 'd6309f4ececefce091893e2198389c491d6171da5bf06b09f4d79669179b3fc0'
export const limeTags = ['critical', 'finance', 'templates', 'clients', 'goals', 'progress', 'profile', 'chat', 'exercises', 'duration']

const featureFiles = [
  ['finance', /^src\/features\/finance\/(?:ClientFinancePage|TrainerFinancePage|TrainerFinanceOverviewPage)(?:\.test)?\.tsx$/],
  ['templates', /^src\/features\/workout-templates\/(?:WorkoutTemplatesPages(?:\.test)?\.tsx|workout-template-draft(?:\.test)?\.ts)$/],
  ['clients', /^src\/features\/clients\/(?:ClientsPages|ClientsListPage|ClientProfilePage|ClientFormPage)(?:\.test)?\.tsx$/],
  ['goals', /^src\/features\/clients\/GoalPages(?:\.test)?\.tsx$/],
  ['progress', /^src\/features\/progress\/(?:ProgressPages|ClientResultsCenter|MeasurementProgressSection|ClientProgressFacts|WorkoutRegularityCard|RunningProgressCard|TrainingSummaryCard|ProgressNextStepSection|InBodyImport|BodyMapAppearanceSetting)(?:\.test)?\.tsx$/],
  ['profile', /^src\/features\/profile\/(?:ProfilePage|TrainerProfileEditorPage|TrainerProfileCard|PublicTrainerProfilePage|TrainerCatalogPage|AppFeedbackForm|SettingsSection|MetroStationPicker|SpecialtyChecklist)(?:\.test)?\.tsx$/],
  ['chat', /^src\/features\/chat\/(?:ChatPages|ChatEntry)(?:\.test)?\.tsx$/],
  ['exercises', /^src\/features\/exercises\/ExercisesPage(?:\.test)?\.tsx$/],
  ['duration', /^src\/features\/workouts\/WorkoutActualDuration(?:\.test)?\.tsx$/],
]

export function selectFitLimeScope(paths, { eventName, now = new Date(), inventoryDigest } = {}) {
  const full = (reason) => ({ mode: 'full', tags: [], reason })
  if (eventName !== 'pull_request') return full('Main and manual runs retain full release acceptance')
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(scopedPrStartsAt)
    || now.getTime() >= Date.parse(scopedPrExpiresAt)) return full('Outside temporary PR window or clock unavailable')
  if (inventoryDigest !== reviewedInventoryDigest) return full('Test inventory changed; review tags before narrowing')
  if (paths.length === 0) return full('No verified diff')
  const tags = new Set(['critical'])
  for (const path of paths) {
    if (path.startsWith('services/api/')) return full('API contract changed alongside the browser')
    if (!requiresE2E([path])) continue
    const feature = featureFiles.find(([, pattern]) => pattern.test(path))
    if (!feature) return full('Shared, unknown or browser infrastructure change')
    tags.add(feature[0])
  }
  if (tags.size === 1) return full('No scoped feature change; use normal non-browser scope gate')
  return { mode: 'scoped', tags: [...tags].sort(), reason: 'Critical routes plus every explicitly affected feature' }
}

function main() {
  const [baseSha, headSha] = process.argv.slice(2)
  const source = readFileSync(new URL('../e2e/trainer-schedule-v2.visual.spec.ts', import.meta.url))
  const selection = selectFitLimeScope(changedPaths(baseSha, headSha), {
    eventName: process.env.EVENT_NAME,
    inventoryDigest: createHash('sha256').update(source).digest('hex'),
  })
  const output = `mode=${selection.mode}\ntags=${selection.tags.join(',')}\n`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output)
  process.stdout.write(output)
  console.log(selection.reason)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
