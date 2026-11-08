(() => {
  'use strict';
  const root=document.documentElement;
  const athlete=new URLSearchParams(location.search).get('audience')==='athlete';
  document.body.classList.toggle('audience-athlete',athlete);
  document.querySelectorAll('[data-audience]').forEach(link=>{
    if(link.dataset.audience===(athlete?'athlete':'trainer'))link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  if(athlete){
    document.querySelector('.copy-stack').replaceChildren(document.querySelector('#athlete-copy').content.cloneNode(true));
    document.querySelector('.screen-window').replaceChildren(document.querySelector('#athlete-screens').content.cloneNode(true));
    document.querySelector('.chapters [data-step="0"] span').textContent='Сегодня';
    document.querySelector('.chapters [data-step="3"] span').textContent='Техника';
    document.querySelector('.closing .kicker').textContent='ФИТ для спортсмена';
    document.title='ФИТ — тренировки самостоятельно или с тренером';
    document.querySelectorAll('[data-placement="trainer-page"]').forEach(a=>a.dataset.placement='athlete-page');
    document.querySelector('footer a').href='?audience=athlete&motion=off#top';
  }

  const story=document.querySelector('.story'), scene=document.querySelector('.scene');
  const grid=document.querySelector('.scene-grid'), zone=document.querySelector('.product-zone');
  const closing=document.querySelector('.closing'), chapters=document.querySelector('.chapters');
  const copies=[...document.querySelectorAll('[data-copy]')];
  const screens=[...document.querySelectorAll('[data-screen]')];
  const buttons=[...document.querySelectorAll('[data-step]')];
  const videos=[...document.querySelectorAll('video')];
  const mediaButton=document.querySelector('.play-media');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const stages=athlete?['schedule','plan','live','technique','result']:['schedule','plan','live','live','result'];
  const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
  const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
  const staticMode=()=>reduced.matches || new URLSearchParams(location.search).get('motion')==='off';
  const END=5.25;
  let frame=0,travel=0,layoutWidth=0,head=0,active=0,inView=true,compactLayout=false;
  let copyHeights=[];
  let lastTick=performance.now(),elapsed=athlete?15*60+45:11*60+58,clockRunning=false,lastMedia='';
  const minutes=document.querySelector('.clock-minutes'),seconds=document.querySelector('.clock-seconds');
  function tick(now=performance.now()) {
    if(clockRunning)elapsed+=(now-lastTick)/1000;
    lastTick=now;
    minutes.textContent=String(Math.floor(elapsed/60)).padStart(2,'0');
    seconds.textContent=String(Math.floor(elapsed%60)).padStart(2,'0');
  }
  function updateMedia(force=false) {
    const running=inView && !document.hidden && !staticMode();
    tick();clockRunning=running && stages[active]==='live';
    const key=running?stages[active]:'paused';
    if(key===lastMedia && !force)return;
    lastMedia=key;mediaButton.hidden=true;
    for(const video of videos) {
      const visible=running && video.closest('[data-screen]')?.dataset.screen===stages[active];
      if(visible)video.play().catch(()=>{if(lastMedia===key)mediaButton.hidden=false;});
      else video.pause();
    }
  }
  function show(element,alpha,accessible=alpha>.5) {
    element.style.opacity=String(alpha);
    element.style.visibility=alpha>.001?'visible':'hidden';
    element.inert=!accessible;
    element.setAttribute('aria-hidden',String(!accessible));
  }
  function setState() {
    frame=0;
    if(!root.classList.contains('motion'))return;
    const rect=story.getBoundingClientRect();
    const p=clamp((head-rect.top)/travel)*END;
    // One continuous timeline drives text and screen. No time-based entry effects.
    const fades=[1,2,3,4,5].map(boundary=>smooth((p-boundary+.18)/.36));
    const weights=[1-fades[0],...fades.map((v,i)=>i===4?v:v-fades[i+1])];
    active=weights.indexOf(Math.max(...weights));
    if(innerWidth<=760 && copyHeights.length){
      const visibleWeight=weights.slice(0,5).reduce((sum,w)=>sum+w,0);
      const copyHeight=visibleWeight>.001?copyHeights.reduce((sum,h,i)=>sum+h*weights[i],0)/visibleWeight:copyHeights[4];
      document.querySelector('.copy-stack').style.height=`${Math.ceil(copyHeight)}px`;
      sizePhone();
    }
    inView=rect.bottom>head && rect.top<innerHeight;
    copies.forEach((copy,i)=>{
      const opacity=smooth((weights[i]-.5)*2);
      show(copy,opacity,active===i);
      copy.style.transform=`translateY(${(1-opacity)*10}px)`;
    });
    screens.forEach(screen=>{
      const alpha=stages.reduce((sum,name,i)=>sum+(screen.dataset.screen===name?weights[i]:0),0);
      show(screen,alpha,screen.dataset.screen===stages[active]);
    });
    const final=weights[5];
    const outro=1-smooth(final*2),intro=smooth((final-.5)*2);
    grid.style.opacity=String(outro);grid.inert=active===5;
    show(chapters,outro,active!==5);show(closing,intro,active===5);
    // Hold the enlarged Live screen all the way through its exit to Result.
    const compact=root.classList.contains('compact');
    const focus=athlete?0:smooth((p-2.4)/.85), scale=1+focus*(compact?0:.22);
    const width=document.querySelector('.screen-window').clientWidth;
    root.style.setProperty('--live',String(weights[2]+weights[3]));
    root.style.setProperty('--live-scale',String(scale));
    root.style.setProperty('--result-pan',String(athlete?0:(compact?80+360*smooth((p-4.1)/.65):70)*width/390));
    root.style.setProperty('--schedule-pan',`${compact&&!athlete?-225*width/390:0}px`);
    root.style.setProperty('--plan-pan',`${compact?-(athlete?150*smooth((p-1.08)/.65):80+320*smooth((p-1.08)/.65))*width/390:0}px`);
    root.style.setProperty('--live-offset',`${-focus*(440+(compact?230*smooth((p-3.3)/.45):0))*scale*width/390}px`);
    buttons.forEach((button,i)=>{
      if(i===active)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');
    });
    updateMedia();
  }
  function queue(){if(!frame)frame=requestAnimationFrame(setState);}
  function layout() {
    if(!root.classList.contains('motion'))return;
    head=parseFloat(getComputedStyle(root).getPropertyValue('--head'));
    const height=window.visualViewport?.height || innerHeight;
    const mobile=innerWidth<=760;
    if(!travel || Math.abs(innerWidth-layoutWidth)>40)compactLayout=mobile && height<740;
    root.classList.toggle('compact',compactLayout);
    root.style.setProperty('--scene-h',`${Math.max(280,height-head)}px`);
    // Address bar expansion changes scene size, not chapter positions.
    if(!travel || Math.abs(innerWidth-layoutWidth)>40){
      layoutWidth=innerWidth;travel=Math.max(520,Math.min(900,height))*5.3;
      root.style.setProperty('--travel',`${travel}px`);
    }
    if(mobile) {
      copyHeights=copies.map(copy=>{
        const visibleChildren=[...copy.children].filter(c=>getComputedStyle(c).display!=='none');
        return Math.max(...visibleChildren.map(c=>c.offsetTop+c.offsetHeight));
      });
      document.querySelector('.copy-stack').style.height=`${Math.ceil(Math.max(...copyHeights))}px`;
    } else document.querySelector('.copy-stack').style.height='';
    sizePhone();
    queue();
  }
  function sizePhone() {
    const mobile=innerWidth<=760;
    // The outer frame always fits. Detail is enlarged inside it, not clipped outside it.
    const maxHeight=zone.clientHeight-12;
    const compact=root.classList.contains('compact');
    const phoneWidth=compact?Math.min(330,zone.clientWidth-12):Math.min(mobile?330:370,(maxHeight-22)*390/844+22,zone.clientWidth-20);
    root.style.setProperty('--window-h',`${Math.max(180,maxHeight-12)}px`);
    root.style.setProperty('--phone-w',`${Math.max(120,phoneWidth)}px`);
  }
  function fallback() {
    root.classList.remove('motion','compact');
    story.after(closing);closing.style='';closing.inert=false;closing.removeAttribute('aria-hidden');
    grid.style='';grid.inert=false;
    copies.forEach((copy,i)=>{
      copy.inert=false;copy.removeAttribute('aria-hidden');copy.style='';
      if(copy.nextElementSibling?.classList.contains('fallback-state'))return;
      const frame=document.createElement('figure');frame.className='fallback-state';
      const source=screens.find(s=>s.dataset.screen===stages[i]);
      const clone=source.cloneNode(true);clone.style='';clone.inert=false;clone.removeAttribute('aria-hidden');
      clone.querySelectorAll('video').forEach(v=>{v.controls=true;v.preload='none';});
      frame.append(clone);copy.after(frame);
    });
    updateMedia();
  }
  function enable() {
    if(staticMode()){fallback();return;}
    document.querySelectorAll('.fallback-state').forEach(e=>e.remove());
    root.classList.add('motion');scene.append(closing);layout();
  }
  function goTo(target) {
    window.scrollTo({top:scrollY+story.getBoundingClientRect().top-head+travel*target/END,behavior:staticMode()?'instant':'smooth'});
  }
  buttons.forEach((button,i)=>button.addEventListener('click',()=>goTo(i===3?3.4:i+.3)));
  document.querySelector('.site-header a[href="#top"]').addEventListener('click',event=>{
    if(!staticMode()){event.preventDefault();goTo(0);}
  });
  document.querySelector('.skip').addEventListener('click',event=>{
    if(!staticMode()){event.preventDefault();goTo(END);}
  });
  mediaButton.addEventListener('click',()=>updateMedia(true));
  addEventListener('scroll',queue,{passive:true});addEventListener('resize',layout);
  visualViewport?.addEventListener('resize',layout);
  document.addEventListener('visibilitychange',()=>updateMedia());
  reduced.addEventListener('change',enable);
  setInterval(()=>tick(),250);
  enable();document.fonts.ready.then(layout);
})();
