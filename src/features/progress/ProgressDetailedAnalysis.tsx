import type { ProgressDetailedAnalysisSection } from './progress-detailed-analysis'

export function ProgressDetailedAnalysis({ sections, compact = false }: { sections: readonly ProgressDetailedAnalysisSection[]; compact?: boolean }) {
  const visibleSections = sections.filter((section) => section.items.length > 0)
  return <div className="progress-detailed-analysis">
    {!compact && <p className="progress-detailed-analysis-lead">Что означают результаты и на чём основан вывод.</p>}
    {visibleSections.length === 0 && <p className="progress-detailed-analysis-empty">Новых выводов сверх показанных результатов пока нет.</p>}
    {visibleSections.map((section) => <section
      key={section.id}
      className="progress-detailed-analysis-section"
      aria-labelledby={`progress-detailed-analysis-${section.id}`}
    >
      <h3 id={`progress-detailed-analysis-${section.id}`}>{section.title}</h3>
      <ul>{section.items.map((item) => <li key={item} data-copy-source="llm">{item}</li>)}</ul>
    </section>)}
  </div>
}
