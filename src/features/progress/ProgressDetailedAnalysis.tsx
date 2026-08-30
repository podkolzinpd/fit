import type { ProgressDetailedAnalysisSection } from './progress-detailed-analysis'

export function ProgressDetailedAnalysis({ sections }: { sections: readonly ProgressDetailedAnalysisSection[] }) {
  return <div className="progress-detailed-analysis">
    <p className="progress-detailed-analysis-lead">ИИ собрал дополнительные выводы. Факты из карточек выше здесь не повторяются.</p>
    {sections.map((section) => <section
      key={section.id}
      className="progress-detailed-analysis-section"
      aria-labelledby={`progress-detailed-analysis-${section.id}`}
    >
      <h3 id={`progress-detailed-analysis-${section.id}`}>{section.title}</h3>
      {section.items.length > 0
        ? <ul>{section.items.map((item) => <li key={item} data-copy-source="llm">{item}</li>)}</ul>
        : <p className="progress-detailed-analysis-empty">{section.emptyMessage}</p>}
    </section>)}
  </div>
}
