import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

// Deliberately excludes titles, errors, stdout, attachments and fixture payloads.
// Source location + project identify a case without persisting user data.
export default class FitLimeTimingReporter {
  attempts = []

  onBegin(config) {
    this.directory = config.projects[0].outputDir
  }

  onTestEnd(test, result) {
    this.attempts.push({
      file: basename(test.location.file), line: test.location.line,
      column: test.location.column, project: test.parent.project().name,
      caseId: test.id, durationMs: result.duration, retry: result.retry,
      status: result.status,
    })
  }

  onEnd(result) {
    const attempts = [...this.attempts].sort((a, b) => b.durationMs - a.durationMs)
    mkdirSync(this.directory, { recursive: true })
    writeFileSync(join(this.directory, 'lime-timings.json'), JSON.stringify({
      status: result.status, durationMs: result.duration, attempts,
    }, null, 2) + '\n')
    console.log('Fit Lime slowest attempts (source locations; milliseconds):')
    for (const item of attempts.slice(0, 10)) {
      console.log(`${item.project} ${item.file}:${item.line}:${item.column} ${item.durationMs}ms retry=${item.retry} ${item.status}`)
    }
  }
}
