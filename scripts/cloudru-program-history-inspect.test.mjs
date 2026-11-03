import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {gzipSync} from 'node:zlib'
import {readFileSync} from 'node:fs'
import {readProgramPacket,compareProgramHistory} from './cloudru-program-history-inspect.mjs'
const fixture=()=>({schemaVersion:4,code:'F01',batchId:'program-history-20261103-f01',clientName:'Synthetic Athlete',matchNames:['Synthetic Athlete','Athlete Synthetic'],workouts:[{
  requestId:randomUUID(),workoutDate:'2026-10-26',startTime:null,endTime:null,actualDurationSec:null,trainingFormat:'with_trainer',notes:'Synthetic source',title:'Synthetic program',
  exercises:[{position:0,source:'system',ref:'snapshot:synthetic',customExerciseId:null,name:'Synthetic movement',muscleGroup:'other',inputKind:'strength',blockId:randomUUID(),blockType:'single',blockPreset:'set',blockRounds:1,restBetweenExercisesSec:0,restBetweenRoundsSec:0,restBetweenSetsSec:0,trainerComment:'СЕТЫ-ПОВТОРЫ: 1*10',sets:[{position:0,weightKg:0,reps:10,durationMin:null,durationSec:null,distanceKm:null,rpe:null}]}],
}]})
function transport(data) {
  const raw=JSON.stringify(data),encoded=gzipSync(raw).toString('base64'),sha256=createHash('sha256').update(raw).digest('hex'),mid=Math.ceil(encoded.length/2)
  return {parts:[encoded.slice(0,mid),encoded.slice(mid)],sha256,scopes:[{code:'F01',sha256,workouts:1,exercises:1,sets:1,from:'2026-10-26',to:'2026-10-26',trainingFormat:'with_trainer'}]}
}
const parser=input=>({draft:{...input,id:null},expectedVersion:null})
test('accepts only a reviewed SHA-exact packet with the actual parser preserving all source fields',()=>{
  const data=fixture(),t=transport(data);assert.deepEqual(readProgramPacket(t.parts,t.sha256,parser,t.scopes).payload,data)
  assert.throws(()=>readProgramPacket(t.parts,t.sha256,parser),/packet_invalid/u)
  assert.throws(()=>readProgramPacket(t.parts,'0'.repeat(64),parser,t.scopes),/packet_invalid/u)
  assert.throws(()=>readProgramPacket(t.parts,t.sha256,input=>({draft:{...input,notes:null},expectedVersion:null}),t.scopes),/packet_invalid/u)
})
test('refuses actor/client IDs, unknown envelope keys, altered counts, format or dates',()=>{
  for(const mutate of [d=>d.trainerId=randomUUID(),d=>d.workouts[0].clientId=randomUUID(),d=>d.workouts[0].id=randomUUID(),
    d=>d.workouts[0].trainingFormat='self',d=>d.workouts[0].workoutDate='2026-10-27',d=>d.workouts[0].exercises=[],d=>d.matchNames.push('Unapproved','Another')]) {
    const d=fixture();mutate(d);const t=transport(d)
    assert.throws(()=>readProgramPacket(t.parts,t.sha256,parser,t.scopes),/packet_invalid/u)
  }
})
const graph=d=>({workouts:[{id:'old',workout_date:d.workoutDate,deleted_at:null,status:'done',training_format:d.trainingFormat}],
  exercises:d.exercises.map(e=>({id:'exercise',workout_id:'old',position:e.position,exercise_name:e.name,trainer_comment:e.trainerComment})),
  sets:[{workout_exercise_id:'exercise',position:0,fact_weight_kg:'0',fact_reps:10,fact_duration_min:null,fact_duration_sec:null,fact_distance_km:null,fact_rpe:null,confirmed_at:'2026-10-26T10:00:00Z'}]})
test('same day with different composition remains a separate workout',()=>{
  const draft=fixture().workouts[0],g=graph(draft);g.exercises[0].exercise_name='Another synthetic movement'
  assert.equal(compareProgramHistory([draft],g).newRecords.length,1)
})
test('detects exact duplicates, edited facts, ambiguous duplicates and unconfirmed sets',()=>{
  const draft=fixture().workouts[0],g=graph(draft)
  assert.equal(compareProgramHistory([draft],g).exactDuplicates.length,1)
  g.sets[0].fact_reps=12;assert.equal(compareProgramHistory([draft],g).conflicts.length,1)
  g.sets[0].fact_reps=10;g.sets[0].confirmed_at=null;assert.equal(compareProgramHistory([draft],g).conflicts.length,1)
  g.sets[0].confirmed_at='2026-10-26T10:00:00Z';g.workouts.push({...g.workouts[0],id:'other'});g.exercises.push({...g.exercises[0],id:'other-exercise',workout_id:'other'})
  assert.equal(compareProgramHistory([draft],g).conflicts.length,1)
})
test('read-only workflow preserves trusted main, fixed target, encryption and VM serialization; apply is absent',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/inspect-cloudru-private-programs.yml',import.meta.url),'utf8')
  assert.match(workflow,/options: \[prepare, inspect, cleanup\]/u)
  assert.match(workflow,/secrets.FIT_ATHLETE_PROGRAM_HISTORY_TARGET/u)
  assert.match(workflow,/group: cloudru-stage-vm\n  cancel-in-progress: false/u)
  assert.match(workflow,/test "\$commit" = "\$GITHUB_SHA"/u)
  assert.match(workflow,/--read-only/u);assert.match(workflow,/--cap-drop=ALL/u)
  assert.match(workflow,/capability.encrypted.json/u)
  assert.doesNotMatch(workflow,/cloudru-journal-import.mjs|options:.*apply|secrets.FIT_WORKOUT_HISTORY_TARGET/u)
  const source=readFileSync(new URL('./cloudru-program-history-inspect.mjs',import.meta.url),'utf8')
  assert.doesNotMatch(source,/saveCompletedWorkout|createClientCard|mode==='apply'/u)
})
