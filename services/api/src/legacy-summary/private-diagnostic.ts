export class PrivateSummaryDiagnostic extends Error {
  constructor(readonly result: {
    answer: string
    issues: string[]
    alternativeStatus: string | null
    modelVersion: string | null
    usage: Record<string, string>
  }) {
    super('private_summary_diagnostic')
  }
}
