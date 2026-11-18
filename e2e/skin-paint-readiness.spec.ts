import {createHash} from 'node:crypto'
import {test,expect} from '@playwright/test'
import {observeEditorImages,settleEditorPaint,captureEditorSources,readEditorSourceProof,type NativeWorkoutSkinContract} from './lime-editor-skin.probe'

const contract:NativeWorkoutSkinContract={selector:'.probe',families:[],knownGuards:[],migrationGuard:'',ownerFilter:'',ownerSelectors:[]}

test('paint readiness waits for a font discovered after initial fonts.ready',async({page})=>{
 let release!:()=>void,settled=false
 const held=new Promise<void>(resolve=>{release=resolve})
 await page.route('**/delayed-paint-font.woff2',async route=>{
  await held
  await route.fulfill({path:'public/for-trainers/assets/onest-cyrillic.woff2',contentType:'font/woff2'})
 })
 await page.route('**/paint-fixture',route=>route.fulfill({contentType:'text/html',body:`<style>@font-face{font-family:LatePaint;src:url('/delayed-paint-font.woff2');font-display:swap}.late-font{font-family:LatePaint,monospace}.probe{font-size:24px}</style><div class="phone-frame"><div class="probe">Тренировка в системе</div></div>`}))
 observeEditorImages(page)
 await page.goto('/paint-fixture')
 await page.evaluate(()=>document.fonts.ready)
 await page.evaluate(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>document.querySelector('.probe')!.classList.add('late-font'))))
 const ready=settleEditorPaint(page,'.probe',contract).then(()=>{settled=true})
 try{
  await expect.poll(()=>page.evaluate(()=>document.fonts.status)).toBe('loading')
  await page.evaluate(async()=>{for(let i=0;i<5;i++)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))})
  expect(settled).toBe(false)
 }finally{release()}
 await ready
 expect(settled).toBe(true)
 expect(await page.evaluate(()=>document.fonts.status)).toBe('loaded')
})

test('paint readiness fails instead of accepting continuously changing geometry',async({page})=>{
 observeEditorImages(page)
 await page.setContent('<style>@keyframes drift{from{width:100px}to{width:200px}}.probe{animation:drift 1s linear infinite alternate;height:20px}</style><div class="phone-frame"><div class="probe">Moving</div></div>')
 const css=await page.locator('style').textContent()
 await expect(settleEditorPaint(page,'.probe',contract)).rejects.toThrow('Editor paint did not settle within 5000 ms')
 expect(await page.locator('style').textContent()).toBe(css)
})

test('paint readiness rejects continuously changing border paint with stable geometry',async({page})=>{
 observeEditorImages(page)
 await page.setContent('<style>@keyframes paint{from{border-color:red}to{border-color:blue}}.probe{animation:paint 1s linear infinite alternate;width:100px;height:20px;border:1px solid}</style><div class="phone-frame"><div class="probe">Painting</div></div>')
 const geometry=()=>page.locator('.probe').evaluate(node=>{const rect=node.getBoundingClientRect();return[rect.x,rect.y,rect.width,rect.height]})
 const before=await geometry(),css=await page.locator('style').textContent()
 await expect(settleEditorPaint(page,'.probe',contract)).rejects.toThrow('Editor paint did not settle within 5000 ms')
 expect(await geometry()).toEqual(before)
 expect(await page.locator('style').textContent()).toBe(css)
})

// These target the new protocol boundary: source strings stay in the browser,
// but stylesheet/DOM changes must remain visible to the existing assertions.
test('source proof preserves the full CSSOM digest and takes a fresh snapshot',async({page})=>{
 await page.goto('/')
 await page.setContent('<style>.probe{color:red}</style><main class="probe">Original</main>')
 const cssom=await page.evaluate(()=>Array.from(document.styleSheets).map(sheet=>Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n')))
 const source=await captureEditorSources(page,'.probe',true)
 try{
  expect(await readEditorSourceProof(source)).toMatchObject({cssomUnchanged:true,domUnchanged:true,styleObjectsUnchanged:true,cssomSHA256:createHash('sha256').update(JSON.stringify(cssom)).digest('hex')})
  await page.locator('.probe').evaluate(node=>node.textContent='Changed')
  expect((await readEditorSourceProof(source)).domUnchanged).toBe(false)
  const fresh=await captureEditorSources(page,'.probe',true)
  try{expect((await readEditorSourceProof(fresh)).domUnchanged).toBe(true)}finally{await fresh.dispose()}
 }finally{await source.dispose()}
})

for(const change of ['stylesheet','declaration'] as const){
 test('source proof detects '+change+' mutation without changing its snapshot',async({page})=>{
  await page.goto('/')
  await page.setContent('<style>.probe{color:red}</style><main class="probe">Original</main>')
  const source=await captureEditorSources(page,'.probe',true)
  try{
   await page.evaluate(change=>{
    const sheet=document.styleSheets[0]!
    if(change==='stylesheet')sheet.insertRule('.probe{background:blue}',sheet.cssRules.length)
    else{const rule=sheet.cssRules[0];if(!(rule instanceof CSSStyleRule))throw Error('style rule required');rule.style.color='blue'}
   },change)
   const proof=await readEditorSourceProof(source)
   expect(proof.cssomUnchanged).toBe(false)
   expect(proof.domUnchanged).toBe(true)
   expect(proof.styleObjectsUnchanged).toBe(change==='stylesheet')
  }finally{await source.dispose()}
 })
}
