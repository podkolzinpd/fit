import test from 'node:test'
import assert from 'node:assert/strict'
import {parseProgramGrid,dateProgramWorkouts,programDrafts,explicitProgramDate} from './private-program-history.mjs'

const fixture = (days=3,weeks=[1,2]) => {
  const grid=[]
  for(let day=1;day<=days;day++) {
    const row=(day-1)*5
    grid[row]=[`День ${day}: (тип занятия)`]
    grid[row+1]=[];grid[row+2]=['N','Упражнение'];grid[row+3]=[1,'Synthetic movement']
    for(const [i,week] of weeks.entries()) {
      const col=2+i*3
      grid[row+1][col]=`Неделя ${week}${i?'':' ✅'}`
      grid[row+2].splice(col,3,'СЕТЫ-ПОВТОРЫ','ИВН','РАБОЧИЙ ВЕС')
      grid[row+3].splice(col,3,'3*10','6.7.8.','20')
    }
    grid[row+4]=[]
  }
  return grid
}
const dateOptions={lastWeekMonday:'2026-10-26',notAfter:'2026-11-03'}
const options={sourceSha256:'a'.repeat(64),fileCode:'F01',trainingFormat:'with_trainer'}
test('keeps all populated blocks irrespective of checkmarks and preserves day labels',()=>{
  const p=parseProgramGrid(fixture());assert.equal(p.workouts.length,6);assert.deepEqual(p.issues,[])
  assert.equal(p.workouts[0].dayLabel,'День 1: (тип занятия)')
})
test('anchors the last populated week, ignoring a completely empty template week',()=>{
  const g=fixture(3,[1,2,3]);for(let row=3;row<g.length;row+=5)g[row].splice(8,3,null,null,null)
  const p=parseProgramGrid(g), d=dateProgramWorkouts(p,dateOptions)
  assert.equal(p.empty.length,3);assert.equal(d.workouts.at(-1).workoutDate,'2026-10-30')
  assert.equal(d.firstWeek,'2026-10-19')
})
test('distributes each weekly count with the approved deterministic schedule',()=>{
  const schedules=[[0],[0,3],[0,2,4],[0,1,3,4],[0,1,2,3,4],[0,1,2,3,4,5],[0,1,2,3,4,5,6]]
  for(let n=1;n<=7;n++) {
    const d=dateProgramWorkouts(parseProgramGrid(fixture(n,[1])),dateOptions)
    assert.deepEqual(d.workouts.map(w=>new Date(w.workoutDate+'T12:00Z').getUTCDay()),schedules[n-1].map(i=>(i+1)%7))
  }
})
test('preserves missing week numbers as a calendar gap',()=>{
  const d=dateProgramWorkouts(parseProgramGrid(fixture(1,[1,2,4,5])),dateOptions)
  assert.deepEqual(d.workouts.map(w=>w.workoutDate),['2026-09-28','2026-10-05','2026-10-19','2026-10-26'])
})
test('preserves explicit dates even when reconstructed chronology differs',()=>{
  const g=fixture(1,[1,2]);g[1][5]='Неделя 2 ✅ 07.10.26'
  const d=dateProgramWorkouts(parseProgramGrid(g),dateOptions)
  assert.equal(d.workouts[1].workoutDate,'2026-10-07');assert.equal(d.workouts[1].dateOrigin,'explicit')
  assert.equal(d.conflicts.length,1)
})
test('does not interpret a reps/intensity value or a yearless header as a calendar date',()=>{
  assert.equal(explicitProgramDate('3.10'),null);assert.equal(explicitProgramDate('Неделя 1 07.10'),null)
  assert.throws(()=>explicitProgramDate('31.02.2026'),/date_invalid/u)
})
test('refuses future performed dates and a moving or invalid anchor',()=>{
  const p=parseProgramGrid(fixture())
  assert.throws(()=>dateProgramWorkouts(p,{...dateOptions,startDate:'2026-11-02'}),/future_performed_date/u)
  assert.throws(()=>dateProgramWorkouts(p,{...dateOptions,lastWeekMonday:'2026-10-27'}),/anchor_invalid/u)
})
test('keeps missing exercise names as raw workout notes instead of inventing movements',()=>{
  const g=fixture(1,[1]);g[4]=[2,null,'4*8','unknown',null]
  const p=parseProgramGrid(g);assert.equal(p.workouts[0].unnamed.length,1)
  const drafts=programDrafts(dateProgramWorkouts(p,dateOptions),options)
  assert.equal(drafts[0].exercises.length,1);assert.match(drafts[0].notes,/без названия упражнения: СЕТЫ-ПОВТОРЫ: 4\*8/u)
  assert.throws(()=>dateProgramWorkouts(parseProgramGrid([['День 1:'],[null,null,'Неделя 1'],['N','Упражнение','СЕТЫ-ПОВТОРЫ','ИВН','ВЕС'],[1,null,'3*8']]),dateOptions),/source_issues/u)
})
test('retains unnumbered named exercises, scalar zero weights, IVN and exact source prescription',()=>{
  const g=fixture(1,[1]);g[3]=[null,'Synthetic movement','3*10','6.7.8.',0]
  const w=programDrafts(dateProgramWorkouts(parseProgramGrid(g),dateOptions),options)[0]
  assert.equal(w.exercises[0].sets.length,3);assert.equal(w.exercises[0].sets[0].weightKg,0)
  assert.equal(w.exercises[0].sets[0].rpe,null);assert.match(w.exercises[0].trainerComment,/ИВН: 6.7.8./u)
})
test('does not guess set metrics from decimal notation, ranges or per-set weight lists',()=>{
  for(const prescription of [3.12,'3.10','3*8-12','3/10']) {
    const g=fixture(1,[1]);g[3][2]=prescription
    const e=programDrafts(dateProgramWorkouts(parseProgramGrid(g),dateOptions),options)[0].exercises[0]
    assert.equal(e.sets.length,0);assert.ok(e.trainerComment.includes(String(prescription)))
  }
  const g=fixture(1,[1]);g[3][4]='20/25/30'
  const e=programDrafts(dateProgramWorkouts(parseProgramGrid(g),dateOptions),options)[0].exercises[0]
  assert.equal(e.sets[0].weightKg,null);assert.match(e.trainerComment,/20\/25\/30/u)
})
test('request and block IDs are deterministic across reordering and distinguish source positions',()=>{
  const d=dateProgramWorkouts(parseProgramGrid(fixture()),dateOptions)
  const a=programDrafts(d,options), b=programDrafts({...d,workouts:[...d.workouts].reverse()},options)
  assert.deepEqual(a,b);assert.equal(new Set(a.map(w=>w.requestId)).size,6)
  assert.equal(programDrafts(d,{...options,trainingFormat:'self'})[0].trainingFormat,'self')
})
test('reads adjacent programs left to right, then the next program below without mixing day rows',()=>{
  const source=fixture(2,[1]),grid=source.map(row=>[...row,...Array(6-row.length).fill(null),...row])
  grid.push(...fixture(2,[1]))
  const p=parseProgramGrid(grid),d=dateProgramWorkouts(p,dateOptions)
  assert.equal(p.programs,3);assert.equal(p.workouts.length,6)
  assert.deepEqual(d.workouts.map(w=>[w.program,w.day,w.workoutDate]),[[1,1,'2026-10-12'],[1,2,'2026-10-15'],[2,1,'2026-10-19'],[2,2,'2026-10-22'],[3,1,'2026-10-26'],[3,2,'2026-10-29']])
})
