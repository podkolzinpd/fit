const {chromium}=require('playwright');
const path=require('path'),fs=require('fs'),cp=require('child_process');
(async()=>{
 const out=path.resolve(__dirname,'../greatfinal-motion-qa/video');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1600,height:900},recordVideo:{dir:out,size:{width:1600,height:900}}});
 const page=await context.newPage();await page.goto('file://'+path.join(__dirname,'motion.html')+'?record');await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(650);await page.keyboard.press('ArrowRight');await page.waitForTimeout(2000);
 await page.evaluate(()=>FIT_MOTION.seek(3,0));await page.waitForTimeout(1200);await page.keyboard.press('ArrowRight');await page.waitForTimeout(2000);
 await page.evaluate(()=>FIT_MOTION.seek(4,0));await page.waitForTimeout(1000);
 for(let i=0;i<3;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(1900);}
 await page.evaluate(()=>FIT_MOTION.seek(5,0));await page.waitForTimeout(1500);
 for(let i=0;i<7;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(i===1?2300:2000);}
 await page.waitForTimeout(1000);await page.keyboard.press('ArrowLeft');await page.waitForTimeout(1300);
 const video=page.video();await context.close();const source=await video.path();await browser.close();
 const target=path.join(__dirname,'assets','motion-key-transitions.mp4');
 cp.execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-hide_banner','-loglevel','error','-i',source,'-c:v','libx264','-crf','23','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart','-an',target]);
 console.log(target);
})().catch(e=>{console.error(e);process.exit(1)});
