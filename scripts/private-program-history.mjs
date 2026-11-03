import {createHash} from 'node:crypto'

// Pure, local preparation. No workbook names, identities, I/O or production writes.
const weekdays = [null,[0],[0,3],[0,2,4],[0,1,3,4],[0,1,2,3,4],[0,1,2,3,4,5],[0,1,2,3,4,5,6]]
const fail = code => { throw new Error(`program_history_${code}`) }
const present = value => value !== null && value !== undefined && !['','-','—','–'].includes(String(value).trim())
const text = value => value === null || value === undefined ? '' : String(value).trim()
const dayNumber = value => /^\s*день\s*(\d+)(?:\s*:|\s*$)/iu.exec(text(value))?.[1]
const isPrescription = value => /сеты/iu.test(text(value)) && /повтор/iu.test(text(value))
const monday = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) fail('date_invalid')
  const date = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) fail('date_invalid')
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay()+6)%7)
  return date.toISOString().slice(0,10)
}
const shift = (value,days) => {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate()+days)
  return date.toISOString().slice(0,10)
}
export function explicitProgramDate(value) {
  const source = text(value)
  if (/^\d{4}-\d{2}-\d{2}$/u.test(source)) { monday(source); return source }
  const match = /(?:^|\s)(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:\s|$)/u.exec(source)
  if (!match) return null
  const year = match[3].length===2 ? `20${match[3]}` : match[3]
  const date = `${year}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`
  monday(date)
  return date
}
const uuid = value => {
  const h = createHash('sha256').update(value).digest('hex').slice(0,32).split('')
  h[12]='5'; h[16]=['8','9','a','b'][parseInt(h[16],16)%4]
  const s=h.join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`
}

export function parseProgramGrid(grid) {
  if (!Array.isArray(grid) || grid.length>500 || grid.some(row=>!Array.isArray(row)||row.length>200)) fail('grid_invalid')
  const cell = (row,col) => grid[row]?.[col] ?? null
  const anchors=[]
  for (let r=0;r<grid.length;r++) for (let c=0;c<grid[r].length;c++) {
    const day=dayNumber(cell(r,c));if (day) anchors.push({row:r,col:c,day:Number(day)})
  }
  if (!anchors.length) fail('days_missing')
  const columns=[...new Set(anchors.map(a=>a.col))].sort((a,b)=>a-b)
  const groups=[]
  for (const col of columns) {
    let group
    for (const anchor of anchors.filter(a=>a.col===col).sort((a,b)=>a.row-b.row)) {
      if (!group || anchor.day<=group.days.at(-1).day) {
        group={column:col,startRow:anchor.row,days:[]}; groups.push(group)
      }
      group.days.push(anchor)
    }
  }
  groups.sort((a,b)=>a.startRow-b.startRow || a.column-b.column)
  const workouts=[], empty=[], issues=[], used=new Set()
  for (const [programIndex,group] of groups.entries()) {
    const endCol=columns.find(c=>c>group.column) ?? Math.max(...grid.map(r=>r.length))
    for (const anchor of group.days) {
      const endRow=anchors.filter(a=>a.col===anchor.col && a.row>anchor.row).sort((a,b)=>a.row-b.row)[0]?.row ?? grid.length
      const headers=[]
      for (let r=anchor.row+1;r<Math.min(endRow,anchor.row+5);r++) for (let c=anchor.col+2;c+2<endCol;c++) {
        if (isPrescription(cell(r,c)) && /ивн/iu.test(text(cell(r,c+1))) && /вес/iu.test(text(cell(r,c+2)))) headers.push({row:r,col:c})
      }
      if (!headers.length) { issues.push({code:'headers_missing',row:anchor.row,column:anchor.col});continue }
      for (const header of headers) {
        const rawHeader=text(cell(header.row-1,header.col))
        const weekMatch=/недел[яи]\s*(\d+)/iu.exec(rawHeader)
        if (!weekMatch) { issues.push({code:'week_missing',row:header.row-1,column:header.col});continue }
        const exercises=[], unnamed=[]
        for (let r=header.row+1;r<endRow;r++) {
          const raw=[cell(r,header.col),cell(r,header.col+1),cell(r,header.col+2)]
          if (!raw.some(present)) continue
          for(let offset=0;offset<3;offset++) if(present(raw[offset])) used.add(`${r}:${header.col+offset}`)
          const order=cell(r,anchor.col), name=text(cell(r,anchor.col+1))
          if (!name) { unnamed.push({row:r,order,...Object.fromEntries(['prescription','ivn','load'].map((key,i)=>[key,raw[i]]))});continue }
          if (name.length>160) { issues.push({code:'name_too_long',row:r,column:anchor.col+1});continue }
          const evidence={row:r,nameColumn:anchor.col+1,metricColumn:header.col,prescription:raw[0],ivn:raw[1],load:raw[2]}
          exercises.push({name,order,evidence})
        }
        const source={program:programIndex+1,day:anchor.day,dayLabel:text(cell(anchor.row,anchor.col)),week:Number(weekMatch[1]),headerRow:header.row,headerColumn:header.col,rawHeader,unnamed}
        if (!exercises.length) {if(unnamed.length)issues.push({code:'no_named_exercises',row:header.row,column:header.col});empty.push(source);continue}
        workouts.push({...source,explicitDate:explicitProgramDate(rawHeader),exercises})
      }
    }
  }
  // Every populated metric cell in a recognized block must have an owner.
  return {workouts,empty,issues,programs:groups.length,consumedMetricCells:used.size}
}

export function dateProgramWorkouts(parsed,{lastWeekMonday,startDate=null,notAfter}) {
  if (parsed.issues.length) fail('source_issues_require_review')
  if (monday(lastWeekMonday)!==lastWeekMonday || !notAfter) fail('anchor_invalid')
  monday(notAfter)
  const programs=[...new Set(parsed.workouts.map(w=>w.program))].sort((a,b)=>a-b)
  const weeks=[]
  for (const program of programs) {
    const numbers=parsed.workouts.filter(w=>w.program===program).map(w=>w.week)
    for(let week=Math.min(...numbers);week<=Math.max(...numbers);week++)weeks.push({program,week})
  }
  const firstWeek=startDate ? monday(startDate) : shift(lastWeekMonday,-7*(weeks.length-1))
  const dated=parsed.workouts.map(source=>{
    const sameWeek=parsed.workouts.filter(w=>w.program===source.program&&w.week===source.week)
    const days=[...new Set(sameWeek.map(w=>w.day))].sort((a,b)=>a-b)
    if(days.length>7 || sameWeek.length!==days.length)fail('day_order_invalid')
    const weekIndex=weeks.findIndex(w=>w.program===source.program&&w.week===source.week)
    const derivedDate=shift(firstWeek,weekIndex*7+weekdays[days.length][days.indexOf(source.day)])
    const workoutDate=source.explicitDate??derivedDate
    if(workoutDate>notAfter)fail('future_performed_date')
    return {...source,workoutDate,dateOrigin:source.explicitDate?'explicit':'reconstructed',derivedDate}
  })
  // Explicit dates never move. Keep source-order disagreements in the report.
  const inSourceOrder=[...dated].sort((a,b)=>a.program-b.program||a.week-b.week||a.day-b.day)
  const conflicts=inSourceOrder.flatMap((w,i)=>i && w.workoutDate<inSourceOrder[i-1].workoutDate ? [{code:'source_date_order_conflict',program:w.program,week:w.week,day:w.day}]:[])
  return {workouts:inSourceOrder,conflicts,firstWeek,lastWeekMonday:shift(firstWeek,7*(weeks.length-1))}
}

export function programDrafts(dated,{sourceSha256,fileCode,trainingFormat}) {
  if(!/^[a-f0-9]{64}$/u.test(sourceSha256) || !/^F\d{2}$/u.test(fileCode) || !['self','with_trainer'].includes(trainingFormat))fail('draft_source_invalid')
  return [...dated.workouts].sort((a,b)=>a.workoutDate.localeCompare(b.workoutDate)||a.program-b.program||a.week-b.week||a.day-b.day).map((w,index)=>{
    const key=`fit-program-20261103:${sourceSha256}:${w.headerRow}:${w.headerColumn}`
    return {sourceOrdinal:index+1,requestId:uuid(key),workoutDate:w.workoutDate,startTime:null,endTime:null,actualDurationSec:null,trainingFormat,
      title:`Программа ${w.program} · Неделя ${w.week} · День ${w.day}`,
      notes:[`Перенос истории. ${fileCode}; программа ${w.program}, неделя ${w.week}, ${w.dayLabel}. ${w.dateOrigin==='explicit'?'Дата из источника.':'Дата восстановлена по согласованному расписанию.'}`,
        ...w.unnamed.map(e=>`Строка ${e.order??e.row+1} без названия упражнения: ${metricNote(e)}`)].join('\n'),
      exercises:w.exercises.map((e,position)=>({position,source:'system',ref:`snapshot:program-history:${uuid(`${key}:${e.evidence.row}`)}`,customExerciseId:null,name:e.name,muscleGroup:'other',inputKind:'strength',blockId:uuid(`${key}:block:${e.evidence.row}`),blockType:'single',blockPreset:'set',blockRounds:1,restBetweenExercisesSec:0,restBetweenRoundsSec:0,restBetweenSetsSec:0,
        trainerComment:metricNote(e.evidence),sets:explicitSets(e.evidence)}))}
  })
}

function metricNote(evidence) {
  return [['СЕТЫ-ПОВТОРЫ',evidence.prescription],['ИВН',evidence.ivn],['РАБОЧИЙ ВЕС',evidence.load]].filter(([,v])=>present(v)).map(([label,v])=>`${label}: ${text(v)}`).join('\n')
}

function explicitSets(evidence) {
  // Only an explicit multiplication notation has an unambiguous set count.
  // Numeric decimals, ranges, per-set lists and IVN remain verbatim comments.
  const match=typeof evidence.prescription==='string' && /^\s*(\d{1,2})\s*[*xх×]\s*(\d{1,3})\s*$/iu.exec(evidence.prescription)
  if(!match || Number(match[1])<1 || Number(match[1])>50 || Number(match[2])<1)return []
  const rawLoad=text(evidence.load).replace(',','.')
  const weightKg=/^\d+(?:\.\d+)?$/u.test(rawLoad) && Number(rawLoad)<=1000 ? Number(rawLoad) : null
  return Array.from({length:Number(match[1])},(_,position)=>({position,weightKg,reps:Number(match[2]),durationMin:null,durationSec:null,distanceKm:null,rpe:null,metricSources:{duration:'unknown',distance:'unknown',rpe:'unknown'}}))
}
