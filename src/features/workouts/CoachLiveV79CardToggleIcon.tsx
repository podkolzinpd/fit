import collapseIcon from '../../assets/coach-live-v79/card-collapse.svg'
import expandIcon from '../../assets/coach-live-v79/card-expand.svg'

/** Same two designer exports, split into their existing arrow quadrants.
 * Source CardToggleIcon rotates each arrow about18,6 /6,18 and crossfades
 * the open/closed paths. No new drawing, asset edits or form state. */
export function CoachLiveV79CardToggleIcon({ folded }: { folded: boolean }) {
  return <span className="coach-v79-toggle-icon" data-folded={folded} aria-hidden="true">
    {['top', 'bottom'].map(arrow => <span key={arrow} className={`coach-v79-toggle-arrow ${arrow}`}>
      <img className="coach-v79-toggle-closed" src={collapseIcon} width="24" height="24" alt="" />
      <img className="coach-v79-toggle-open" src={expandIcon} width="24" height="24" alt="" />
    </span>)}
  </span>
}
