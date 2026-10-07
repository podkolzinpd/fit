import { useContext } from 'react'
import { FitLimeIconsContext } from './fit-lime-icons'
import { AddIcon } from './icons'

/** Share the approved icon vocabulary; preserve non-Lime labels. */
export function AddActionLabel({ children }: { children: string }) {
  const lime = useContext(FitLimeIconsContext)
  return lime ? <span className="fit-lime-add-label"><AddIcon />{children}</span> : <>＋ {children}</>
}
