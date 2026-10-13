/* Слайд 03 «Спортивный суперапп»: иконки приложений сливаются в Fit (13.10.2026).
   Рисует слайд в Shadow DOM поверх исходной секции; шаг берёт из data-motion-step,
   который выставляет motion-progress-polish.js (0 — приложения, 1 — собираем в Fit). */
(function(){
  const sec=document.querySelector('#deck>[data-section="03 · ПРОДУКТОВАЯ ИДЕЯ"]');
  if(!sec) return;
  const CSS="\n:host{--dark:#141719;--lime:#d6f500;--paper:#f5f3ee;--muted:#a7acae;--line:#3b4144;--ease:cubic-bezier(.2,.75,.25,1)}\n*{box-sizing:border-box;margin:0;padding:0}\n\n:host{all:initial}\n.slide{position:relative;width:1600px;height:900px;background:var(--dark);overflow:hidden;font-family:\"Onest\",-apple-system,\"Segoe UI\",system-ui,sans-serif;color:var(--paper)}\n.eyebrow{position:absolute;left:76px;top:70px;font-size:15px;letter-spacing:.14em;font-weight:700;color:#929da9;text-transform:uppercase}\n.eyebrow b{color:var(--lime)}\nh2{position:absolute;left:76px;top:112px;font-size:58px;line-height:1.08;font-weight:800;letter-spacing:-1.8px}\n.rule{position:absolute;left:76px;top:203px;width:58px;height:3px;background:var(--lime)}\n.lead{position:absolute;left:76px;top:236px;font-size:25px;line-height:1.4;color:#d7dbe0;width:980px}\n\n/* категории */\n.cat{position:absolute;width:300px;border-top:1px solid #929da955;padding-top:16px;transition:opacity .6s var(--ease),filter .6s}\n.cat h3{font-size:24px;line-height:1.25;font-weight:800;color:var(--paper)}\n.cat p{font-size:19px;color:#c2c7d0;margin-top:8px}\n.cat .ics{display:flex;gap:16px;margin-bottom:16px;height:92px}\n.c1{left:76px;top:332px}.c2{left:1224px;top:332px}.c3{left:76px;top:560px}.c4{left:1224px;top:560px}\n\n\n/* иконки приложений */\n.ic{width:92px;height:92px;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.45);background:#222;position:relative;z-index:5;will-change:transform}\n.ic img{width:100%;height:100%;display:block}\n\n/* центр: Fit */\n.hub{position:absolute;left:800px;top:448px;width:0;height:0}\n.fit{position:absolute;left:-104px;top:-150px;width:208px;height:208px;border-radius:48px;opacity:0;z-index:6}\n.fit img{width:100%;height:100%;display:block}\n.glow{position:absolute;left:-170px;top:-216px;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(214,245,0,.5),rgba(214,245,0,0) 65%);opacity:0}\n.ring{position:absolute;left:-104px;top:-150px;width:208px;height:208px;border-radius:48px;border:3px solid var(--lime);opacity:0}\n.word{position:absolute;left:-76px;top:84px;width:152px;height:78px;opacity:0}\n.claim{position:absolute;left:-400px;width:800px;top:190px;text-align:center;font-size:30px;line-height:1.3;font-weight:800;opacity:0}\n.claim em{font-style:normal;color:var(--lime)}\n@keyframes glow{0%{opacity:0;transform:scale(.3)}35%{opacity:1;transform:scale(1)}100%{opacity:.35;transform:scale(1.15)}}\n@keyframes ring{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.7)}}\n@keyframes bump{0%{transform:scale(.4)}45%{transform:scale(1.12)}70%{transform:scale(.96)}100%{transform:scale(1)}}\n\n.bottom{position:absolute;left:76px;top:792px;font-size:19px;color:#c2c7d0;transition:opacity .6s}\n.bottom b{display:block;color:var(--lime);font-weight:600;font-size:24px;margin-bottom:10px}\n\n", HTML="<div class=\"slide\" id=\"sl\">\n  <div class=\"eyebrow\"><b>03</b> · Продуктовая идея</div>\n  <h2>Спортивный суперапп</h2>\n  <div class=\"rule\"></div>\n  <div class=\"lead\">Тренировки, питание, общение с тренером, оплата занятий и сообщество —<br>сегодня в разных приложениях.</div>\n\n  <div class=\"cat c1\"><div class=\"ics\"><div class=\"ic\"><img src=\"assets/superapp/mifitness.jpg\" alt=\"Mi Fitness\"></div><div class=\"ic\"><img src=\"assets/superapp/huawei.jpg\" alt=\"Huawei Health\"></div></div><div class=\"tx\"><h3>Активность и здоровье</h3><p>Mi Fitness · Huawei Health</p></div></div>\n  <div class=\"cat c2\"><div class=\"ics\"><div class=\"ic\"><img src=\"assets/superapp/fitstars.jpg\" alt=\"FitStars\"></div><div class=\"ic\"><img src=\"assets/superapp/hevy.jpg\" alt=\"Hevy\"></div></div><div class=\"tx\"><h3>Тренировки</h3><p>FitStars · Hevy</p></div></div>\n  <div class=\"cat c3\"><div class=\"ics\"><div class=\"ic\"><img src=\"assets/superapp/fatsecret.jpg\" alt=\"FatSecret\"></div><div class=\"ic\"><img src=\"assets/superapp/yazio.jpg\" alt=\"YAZIO\"></div></div><div class=\"tx\"><h3>Питание</h3><p>FatSecret · YAZIO</p></div></div>\n  <div class=\"cat c4\"><div class=\"ics\"><div class=\"ic\"><img src=\"assets/superapp/ddx.jpg\" alt=\"DDX Fitness\"></div><div class=\"ic\"><img src=\"assets/superapp/trainerize.jpg\" alt=\"Trainerize\"></div></div><div class=\"tx\"><h3>Занятия с тренером</h3><p>DDX · Trainerize</p></div></div>\n\n  <div class=\"hub\">\n    <div class=\"glow\"></div>\n    <div class=\"ring\"></div>\n    <div class=\"fit bump\"><img src=\"assets/superapp/fit_icon.png\" alt=\"Fit\"></div>\n    <img class=\"word\" src=\"assets/superapp/fit_word.png\" alt=\"фит\">\n    <div class=\"claim\">Собираем всё это в <em>Fit</em> —<br>одном приложении для спорта</div>\n  </div>\n\n  <div class=\"bottom\"><b>От отдельных тренировок — к системе</b>По нашей оценке, в России пока нет явного лидера среди спортивных приложений.</div>\n</div>";
  [...sec.children].forEach(el=>el.style.setProperty('display','none','important'));
  const hideCss=document.createElement('style');
  hideCss.textContent='#deck>[data-section="03 · ПРОДУКТОВАЯ ИДЕЯ"]>*:not(.superapp-merge-host){display:none!important}';
  document.head.append(hideCss);
  sec.style.setProperty('padding','0','important');
  const host=document.createElement('div'); host.className='superapp-merge-host';
  host.style.cssText='position:absolute;left:0;top:0;width:1600px;height:900px';
  sec.append(host);
  const root=host.attachShadow({mode:'open'});
  root.innerHTML='<style>'+CSS+'</style>'+HTML;
  const sl=root.getElementById('sl'), HUB={x:800,y:402};
  const ics=[...root.querySelectorAll('.ic')], fades=[...root.querySelectorAll('.cat .tx, .bottom')], lines=[...root.querySelectorAll('.cat')];
  const fit=root.querySelector('.fit'), glow=root.querySelector('.glow'), ring=root.querySelector('.ring'), word=root.querySelector('.word'), claim=root.querySelector('.claim');
  let anims=[];
function A(el,kf,opt){const a=el.animate(kf,Object.assign({fill:'forwards'},opt));anims.push(a);return a;}
function reset(){anims.forEach(a=>a.cancel());anims=[];}
function go(step){
  reset(); if(step!==2) return;
  const r0=sl.getBoundingClientRect(), k=r0.width/1600||1;
  ics.forEach((ic,i)=>{
    const r=ic.getBoundingClientRect();
    const dx=HUB.x-(r.left-r0.left+r.width/2)/k, dy=HUB.y-(r.top-r0.top+r.height/2)/k, rot=(i%2?1:-1)*20;
    A(ic,[{transform:'translate(0,0) scale(1) rotate(0deg)',opacity:1},
          {transform:`translate(${dx*0.55}px,${dy*0.55}px) scale(.85) rotate(${rot/2}deg)`,opacity:1,offset:.5},
          {transform:`translate(${dx}px,${dy}px) scale(.42) rotate(${rot}deg)`,opacity:1,offset:.88},
          {transform:`translate(${dx}px,${dy}px) scale(.25) rotate(${rot}deg)`,opacity:0}],
      {duration:1000,delay:i*70,easing:'cubic-bezier(.55,0,.4,1)'});
  });
  fades.forEach(el=>A(el,[{opacity:1},{opacity:.28}],{duration:700,easing:'ease'}));
  lines.forEach(el=>A(el,[{borderTopColor:'#929da955'},{borderTopColor:'#929da918'}],{duration:700}));
  A(glow,[{opacity:0,transform:'scale(.3)'},{opacity:1,transform:'scale(1)',offset:.35},{opacity:.35,transform:'scale(1.15)'}],{duration:1600,delay:850,easing:'ease-out'});
  A(fit,[{opacity:0,transform:'scale(.4)'},{opacity:1,transform:'scale(1.12)',offset:.45},{opacity:1,transform:'scale(.96)',offset:.7},{opacity:1,transform:'scale(1)'}],{duration:800,delay:800,easing:'ease-out'});
  A(ring,[{opacity:.9,transform:'scale(1)'},{opacity:0,transform:'scale(1.7)'}],{duration:1000,delay:1150,easing:'ease-out'});
  A(word,[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],{duration:550,delay:1400,easing:'ease-out'});
  A(claim,[{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:550,delay:1700,easing:'ease-out'});
}

  const isStatic=()=>new URLSearchParams(location.search).has('static')||sec.classList.contains('m-static');
  let cur=-1;
  function render(){
    const n=Number(sec.dataset.motionStep||0), step=n>=1||isStatic()?2:1;
    if(step===cur) return;
    const animateIt=step===2&&cur===1&&!isStatic();
    cur=step; go(step);
    if(step===2&&!animateIt) anims.forEach(a=>a.finish());
  }
  new MutationObserver(render).observe(sec,{attributes:true,attributeFilter:['data-motion-step','class']});
  render();
  window.FIT_SUPERAPP_MERGE={replay:()=>{cur=1;render();}};
})();
