const {chromium}=require('playwright');
const path=require('path'),fs=require('fs'),cp=require('child_process');
(async()=>{
 const out=path.resolve(__dirname,'../greatfinal-motion-qa-v3/video');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:out,size:{width:1920,height:1080}}});
 const page=await context.newPage();await page.goto('file://'+path.join(__dirname,'motion.html')+'?record#5');await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(3000);
 // Continuous playback: three trainer states, eight client states, two growth states.
 // Ordinary next-step navigation, including slide boundaries; no edited montage.
 for(let i=0;i<12;i++){await page.keyboard.press('ArrowRight');await page.waitForTimeout(3100);}
 const video=page.video();await context.close();const source=await video.path();await browser.close();
 const target=path.join(__dirname,'assets','motion-key-transitions.mp4');
 cp.execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-hide_banner','-loglevel','error','-i',source,'-c:v','libx264','-crf','23','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart','-an',target]);
 console.log(target);
})().catch(e=>{console.error(e);process.exit(1)});
