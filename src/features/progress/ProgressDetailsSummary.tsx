import type { ReactNode } from 'react'
import { ChevronDownIcon } from '../../shared/icons'

export function ProgressDetailsSummary({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return <summary className="progress-details-toggle"><span className="progress-details-copy"><span>{children}</span>{description && <small>{description}</small>}</span><ChevronDownIcon /></summary>
}
