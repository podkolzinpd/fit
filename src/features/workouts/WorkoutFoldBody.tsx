import type { PropsWithChildren } from 'react'

/** Shared v79 fold: presentation clips the same mounted forms and drafts. */
export function WorkoutFoldBody({ folded, className, children }: PropsWithChildren<{ folded: boolean; className: string }>) {
  return <div className={`${className}${folded ? ' folded' : ''}`} inert={folded} aria-hidden={folded}><div>{children}</div></div>
}
