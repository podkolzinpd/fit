import type { ReactNode } from 'react'
import { ChevronDownIcon } from '../../shared/icons'

export function ProgressDetailsSummary({ children }: { children: ReactNode }) {
  return <summary className="progress-details-toggle"><span>{children}</span><ChevronDownIcon /></summary>
}
