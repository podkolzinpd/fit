const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert');
const root=__dirname, out=path.resolve(root,'../greatfinal-motion-qa-v2');
const uri=(file)=>'file://'+path.join(root,file);
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch();
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(uri('motion.html'));await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>!!window.FIT_MOTION);
 const report={baseline:'ae7eb6a535cbe385e091745cacd0e08b39249382',steps:[],errors};
 const max=await page.evaluate(()=>FIT_MOTION.max);
 for(let i=0;i<15;i++){
   await page.evaluate(i=>FIT_MOTION.seek(i,i<10?FIT_MOTION.max[i]:0),i);
   await page.waitForTimeout(1300);
   await page.screenshot({path:path.join(out,`motion-${String(i+1).padStart(2,'0')}.png`)});
 }
 for(let i=0;i<10;i++)for(let n=0;n<=max[i];n++){
   await page.evaluate(([i,n])=>FIT_MOTION.seek(i,n),[i,n]);await page.waitForTimeout(1250);
   const state=await page.evaluate(()=>FIT_MOTION.state());assert.equal(state.index,i);assert.equal(state.step,n);
   const issues=await page.evaluate(()=>{
     const slide=document.querySelector('.slide.active'),r=slide.getBoundingClientRect();
     return [...slide.querySelectorAll('.m-workout,.m-token,.m-client-title,.m-client-note,.m-result-data,.m-body-data,.m-concept-categories>div,.m-concept-hub')].filter(el=>{
       for(let p=el;p&&p!==slide;p=p.parentElement){const cs=getComputedStyle(p);if(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity<.1)return false;}
       const a=el.getBoundingClientRect();return a.left<r.left-1||a.right>r.right+1||a.top<r.top-1||a.bottom>r.bottom+1;
     }).map(el=>({cls:el.className,text:el.textContent.slice(0,70)}));
   });
   report.steps.push({slide:i+1,step:n,issues});
   if(i===4){
     const overlap=await page.locator('.m-trainer-gallery .m-screen-window').evaluateAll(els=>{const r=els.map(e=>e.getBoundingClientRect());return r.some((a,i)=>r.some((b,j)=>j>i&&Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)));});
     assert(!overlap,'Trainer screens overlap at step '+n);
   }
   if([0,3,4,5].includes(i))await page.screenshot({path:path.join(out,`scene-${i+1}-${n}.png`)});
 }
 await page.evaluate(()=>FIT_MOTION.seek(5,1));await page.keyboard.press('ArrowRight');await page.evaluate(()=>FIT_MOTION.ready());
 assert.equal((await page.evaluate(()=>FIT_MOTION.state())).step,2);
 const card=await page.locator('.m-workout').evaluate(el=>{window.testCard=el;return el.outerHTML;});
 await page.keyboard.press('ArrowRight');await page.evaluate(()=>FIT_MOTION.ready());
 assert(await page.locator('.m-workout').evaluate(el=>el===window.testCard),'Card must persist across scenes');
 await page.keyboard.press('ArrowLeft');await page.evaluate(()=>FIT_MOTION.ready());assert.equal((await page.evaluate(()=>FIT_MOTION.state())).step,2);
 // Regression: mixing pointer clicks and keys must stay in the current scene.
 await page.evaluate(()=>FIT_MOTION.seek(5,0));
 await page.locator('.m-toolbar [data-action="next"]').click();
 await page.keyboard.press('ArrowRight');
 assert.deepEqual(await page.evaluate(()=>[FIT_MOTION.state().index,FIT_MOTION.state().step]),[5,2]);
 await page.keyboard.press('ArrowLeft');
 assert.deepEqual(await page.evaluate(()=>[FIT_MOTION.state().index,FIT_MOTION.state().step]),[5,1]);
 await page.keyboard.press('Enter');
 assert.deepEqual(await page.evaluate(()=>[FIT_MOTION.state().index,FIT_MOTION.state().step]),[5,2]);
 await page.locator('.m-toolbar select').focus();await page.keyboard.press('p');
 assert.equal((await page.evaluate(()=>FIT_MOTION.state())).index,5);
 await page.locator('.m-toolbar select').evaluate(el=>el.blur());
 report.mixedInput=true;
 await page.evaluate(()=>FIT_MOTION.seek(7,0));await page.keyboard.press('ArrowLeft');assert.deepEqual(await page.evaluate(()=>[FIT_MOTION.state().index,FIT_MOTION.state().step]),[6,1]);
 await page.evaluate(()=>FIT_MOTION.seek(4,3));await page.evaluate(()=>FIT_MOTION.seek(3,0));await page.evaluate(()=>FIT_MOTION.seek(4,0));assert.equal((await page.evaluate(()=>FIT_MOTION.state())).step,0);
 await page.evaluate(()=>FIT_MOTION.seek(5,1));await page.evaluate(()=>FIT_MOTION.play());await page.waitForTimeout(4350);await page.evaluate(()=>FIT_MOTION.pause());const paused=await page.evaluate(()=>FIT_MOTION.state());await page.waitForTimeout(4500);assert.equal((await page.evaluate(()=>FIT_MOTION.state())).step,paused.step);
 await page.evaluate(()=>FIT_MOTION.seek(0,0));await page.keyboard.press('f');await page.waitForTimeout(100);report.fullscreen=await page.evaluate(()=>!!document.fullscreenElement);await page.keyboard.press('f');
 await page.selectOption('.m-toolbar select','8');assert.equal((await page.evaluate(()=>FIT_MOTION.state())).index,8);
 await page.evaluate(()=>location.hash='#6');await page.waitForTimeout(100);assert.equal((await page.evaluate(()=>FIT_MOTION.state())).index,5);
 await page.goto(uri('motion.html')+'?static');await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>FIT_MOTION.seek(5));assert.equal(await page.locator('.m-client-stage').getAttribute('aria-hidden'),'true');
 const baseline=await browser.newPage({viewport:{width:1920,height:1080}});await baseline.goto(uri('index.html'));await baseline.evaluate(()=>document.fonts.ready);
 await page.goto(uri('motion.html'));await page.evaluate(()=>document.fonts.ready);
 report.untouched=[];
 for(let i=10;i<15;i++){
   await baseline.evaluate(i=>show(i),i);await page.evaluate(i=>FIT_MOTION.seek(i),i);await page.waitForTimeout(1400);
   const before=await baseline.locator('#deck>.slide.active').evaluate(el=>el.outerHTML),after=await page.locator('#deck>.slide.active').evaluate(el=>el.outerHTML);
   if(i===13){
     assert.equal(after.replace(' motion-team-framing',''),before,'Team content changed beyond photo framing');
     report.teamContentPreserved=true;continue;
   }
   assert.equal(after,before,'Out of scope DOM changed');
   const a=await baseline.screenshot(),b=await page.screenshot();
   report.untouched.push({slide:i+1,domIdentical:true,pixelsIdentical:a.equals(b)});
   assert(a.equals(b),'Out of scope pixels changed: '+(i+1));
 }
 await page.goto(uri('motion.html'));await page.evaluate(()=>document.fonts.ready);await page.pdf({path:path.join(out,'motion-print.pdf'),width:'1600px',height:'900px',printBackground:true,preferCSSPageSize:true});
 const reducedPage=await browser.newPage({reducedMotion:'reduce'});await reducedPage.goto(uri('motion.html'));report.reducedMotion=await reducedPage.evaluate(()=>FIT_MOTION.state().staticMode);assert(report.reducedMotion);
 report.originalFilesUnchanged=['index.html','fit-design.css','fit-design-calm.js'].every(f=>{const cp=require('child_process');return fs.readFileSync(path.join(root,f)).equals(cp.execFileSync('git',['show',report.baseline+':'+f],{cwd:root,maxBuffer:20e6}));});
 assert(report.originalFilesUnchanged);assert.equal(errors.length,0);
 fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({steps:report.steps.length,issues:report.steps.filter(x=>x.issues.length),untouched:report.untouched,fullscreen:report.fullscreen,errors},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
