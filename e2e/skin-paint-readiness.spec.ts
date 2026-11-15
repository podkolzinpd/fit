import {test,expect} from '@playwright/test'
import {observeEditorImages,settleEditorPaint,type NativeWorkoutSkinContract} from './lime-editor-skin.probe'

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
