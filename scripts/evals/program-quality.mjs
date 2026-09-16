import {writeFileSync, mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
const token = process.env.YANDEX_IAM_TOKEN
if (!token || !process.env.YANDEX_CLOUD_FOLDER_ID) throw new Error('Set YANDEX_IAM_TOKEN and YANDEX_CLOUD_FOLDER_ID for this explicit paid synthetic evaluation.')
process.env.ASSISTANT_PROGRAM_ENABLED='true'
process.env.ASSISTANT_PROGRAM_PILOT_USER_IDS='synthetic-trainer'
const outputDir = process.argv[2]
if (!outputDir) throw new Error('Pass an output directory for synthetic results.')
mkdirSync(outputDir, {recursive:true})
let failed = false
let activeProfile = 'setup'
let completionIndex = 0
const original=globalThis.fetch
globalThis.fetch = async (url, options) => {
 if (String(url).startsWith('http://169.254.169.254/')) return new Response(JSON.stringify({ access_token: token }))
 const response = await original(url, options)
 if (String(url).includes('foundationModels')) {
  const result = await response.clone().json()
  writeFileSync(outputDir + '/' + activeProfile + '-completion-' + (++completionIndex) + '.json', JSON.stringify(result.result?.alternatives ?? [], null, 2))
 }
 return response
}
const base = new URL('../../services/api/dist/', import.meta.url).href
const {handler}=await import(base+'yandex-program-generator-function.js')
const {fixture}=await import(base+'assistant-orchestrator/program/fixtures.js')
const {buildProgramHistoryContext}=await import(base+'assistant-orchestrator/program/context.js')
const {materializeProgram}=await import(base+'assistant-orchestrator/program/generate.js')
const {readSavePlannedWorkoutRequest}=await import(base+'planned-workout-request.js')


const {assessProgramQuality}=await import(base+'assistant-orchestrator/program/quality.js')
const profiles=[
 {name:'return-weight-endurance',frequency:3,experience:'returning',experienceText:'Пять лет тренировок, перерыв два месяца',goal:'weight_loss',goalText:'Начать снижение веса и улучшить общую выносливость',durationMin:90},
 {name:'beginner-short',frequency:2,experience:'beginner',goal:'general_fitness',goalText:'Начать регулярные тренировки для общей формы',durationMin:30},
 {name:'experienced-strength',frequency:3,experience:'experienced',goal:'strength',goalText:'Увеличить силу в приседе и жиме лёжа',durationMin:75},
]
for (const profile of profiles.filter(profile => !process.argv[3] || profile.name === process.argv[3])) {
 activeProfile = profile.name
 const brief={...fixture(profile.frequency).brief,...profile,limitations:'none',preferences:'нет',otherActivity:'нет'}
 delete brief.name
 const context=buildProgramHistoryContext({clientId:'synthetic-client',periodStart:'2026-07-22',periodEnd:'2026-09-15',workouts:[],exercises:[],sets:[]})
 const start=Date.now()
 const result=await handler({httpMethod:'POST',body:{actorId:'synthetic-trainer',operationId:crypto.randomUUID(),today:'2026-09-15',brief,context}})
 const data=JSON.parse(result.body)
 writeFileSync(outputDir+'/'+profile.name+'.json',JSON.stringify({brief,...data},null,2))
 console.log(JSON.stringify({profile:profile.name,status:result.statusCode,seconds:Math.round((Date.now()-start)/1000),issues:data.issues,calls:data.metrics?.length,quality:data.template?assessProgramQuality(data.template,brief):null}))
 if(result.statusCode!==200){failed = true; continue}
 const program=materializeProgram(data.template,brief,'b3942b20-52a2-4d5d-9895-b3b63cf61442',crypto.randomUUID())
 assert.equal(program.canonicalWorkouts.length,profile.frequency*4)
 for(const workout of program.canonicalWorkouts) assert(readSavePlannedWorkoutRequest(workout,null), 'Generated workout must satisfy the persistence contract')
 if(profile.name==='experienced-strength') {
  const refs = new Set(data.template.sessions.flatMap(session => session.exercises.map(exercise => exercise.exerciseRef)))
  assert(refs.has('barbell-squat') && refs.has('bench-press'), 'Named strength targets must remain in the program')
 }
 if(profile.name==='return-weight-endurance') assert(assessProgramQuality(data.template,brief).weeks.every(week=>week.aerobicMinutes>0), 'Endurance goal must have aerobic work in this unrestricted profile')
}

if (failed) process.exitCode = 1
