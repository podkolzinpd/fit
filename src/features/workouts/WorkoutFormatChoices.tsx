import './workout-format-choices.css'
import type { WorkoutTrainingFormat } from '../../shared/domain'
export function WorkoutFormatChoices({format,deliveryMode,onChange,disabled=false}:{format:WorkoutTrainingFormat;deliveryMode:'in_person'|'online';onChange:(format:WorkoutTrainingFormat,delivery:'in_person'|'online')=>void;disabled?:boolean}) {
 return <div className="workout-record-mode workout-format-choices" role="group" aria-label="Формат тренировки">{([
 ['with_trainer','in_person','С тренером'],['with_trainer','online','Онлайн'],['self','in_person','Самостоятельно'],
 ] as const).map(([value,delivery,label])=><button type="button" key={label} disabled={disabled} className={format===value&&(value==='self'||deliveryMode===delivery)?'active':''} aria-pressed={format===value&&(value==='self'||deliveryMode===delivery)} onClick={()=>onChange(value,delivery)}>{label}</button>)}</div>
}
