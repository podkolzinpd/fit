import { createContext } from 'react'

/** Presentation inherited by nested controls and portals from the real shell
 * gate. It never grants access or derives a cohort from browser preferences. */
export const ClientWorkoutReferenceContext = createContext(false)
