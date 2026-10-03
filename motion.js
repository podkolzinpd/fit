/* Fit motion edition. Baseline ae7eb6a535cbe385e091745cacd0e08b39249382.
 * Only the first ten sections opt in. Original content/resources are retained.
 * Mechanics adapted from the supplied FIT_motion_demo.html: travelling tokens,
 * one persistent workout object, reversible scenes and an evidence-led body map.
 */
(() => {
  'use strict';
  const all = [...document.querySelectorAll('#deck > .slide')];
  const scope = all.slice(0, 10);
  const originalShow = window.show;
  if (scope.length !== 10 || !originalShow) return;
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let staticMode = params.has('static') || reduced.matches;
  let index = Math.max(0, all.findIndex(s => s.classList.contains('active')));
  let step = 0, playing = false, timer = null;
  const animations = new Set();
  const max = [1, 3, 8, 2, 4, 8, 4, 5, 5, 3];
  const labels = [
    ['Фотография','Твой спорт. Твоя команда.'],
    ['Для клиента','Для тренера','Масштаб рынка','Вся идея'],
    ['Жители России','15–59 лет','Занимаются спортом','Аудитория Fit','Товары и одежда','Фитнес-услуги','Секции и питание','Устройства и онлайн','Весь рынок'],
    ['Разные приложения','Собираем вокруг Fit','Концепция развития'],
    ['Весь маршрут','Выбрать клиента','Создать тренировку','Оценить прогресс','Все возможности'],
    ['Все возможности','Голосом или текстом','Слова → упражнения','План','Выполнение','Завершение','Было → стало','Карта тела','Все возможности'],
    ['14 сентября','20 сентября','2 октября','Записи тренировок','Итог и методика'],
    ['Тренеры и клиенты','Яндекс Плюс','Спортивные события','Обучение тренеров','Экосистема Яндекса','Все каналы'],
    ['Мессенджер · Телемост','Pay · Сплит','Бенефит для компаний','Директ · Практикум','Лавка · Еда · Маркет','Все сценарии'],
    ['Подписка','Комиссия','Реклама','Вся модель']
  ];
  scope.forEach((s,i) => { s.classList.add('motion-slide'); s.dataset.motionSlide = i; });
  function phase(el, n) { if(el) { el.classList.add('m-reveal'); el.dataset.phase=n; } }
  function note(s, text) { const el=document.createElement('div');el.className='m-status-note';el.textContent=text;s.append(el);return el; }
  function animate(el, frames, duration=850) {
    if(staticMode || !el) return;
    const a=el.animate(frames,{duration,easing:'cubic-bezier(.2,.75,.25,1)'});
    animations.add(a);a.finished.catch(()=>{}).finally(()=>animations.delete(a));return a;
  }
  function settle() { animations.forEach(a=>a.finish());animations.clear(); }
  // Cover: preserve every pixel of the original photo/logo/wording; reveal the
  // existing title region independently instead of generating a different image.
  const cover=q('img[src="cover-people.png"]',scope[0]);
  cover.classList.add('m-cover-base');
  const coverTitle=cover.cloneNode();coverTitle.className='m-cover-layer m-cover-title';coverTitle.alt='';coverTitle.setAttribute('aria-hidden','true');scope[0].append(coverTitle);
  // Idea: the existing blocks, now with editorial contrast and a single reading order.
  scope[1].classList.add('m-light');
  qa('.content section',scope[1]).forEach((el,i)=>phase(el,i));
  phase(q('.content>div>div:last-child',scope[1]),2);
  // Market: reveal original SVG elements in place, never rescale one group alone.
  const market=scope[2];market.classList.add('m-light');
  qa('svg text',market).forEach(el=>{const c=el.getAttribute('fill');el.setAttribute('fill',c==='#d6f500'?'#3c491a':c==='#b7bcbe'||c==='#a7acae'?'#596166':'#202527');});
  const rects=qa('svg rect[x="0"]',market), paths=qa('svg path',market), aud=qa('svg text[x="222"]',market);
  rects.forEach((el,i)=>phase(el,i));paths.forEach((el,i)=>phase(el,i));aud.forEach((el,i)=>phase(el,Math.floor(i/2)));
  phase(q('svg text[y="532"]',market),3);
  const stack=qa('svg rect[x="754"]',market), markers=qa('svg rect[x="1000"]',market);
  const cat=qa('svg text[x="1022"]',market), a2025=qa('svg text[x="1300"]',market).slice(1), a2031=qa('svg text[x="1410"]',market).filter(x=>+x.getAttribute('y')>109);
  [stack,markers,cat,a2025,a2031].forEach(group=>group.forEach((el,i)=>phase(el,i<2?4:i===2?5:i<5?6:7)));
  // Product idea: original four category blocks travel towards one Fit core.
  const concept=scope[3];concept.classList.add('m-concept');
  const cc=q('.content',concept), children=[...cc.children];
  children[0].classList.add('m-concept-intro');children[1].classList.add('m-concept-hub');children[2].classList.add('m-concept-market');children[3].classList.add('m-concept-categories');
  const conceptLabel=document.createElement('span');conceptLabel.className='m-concept-label';conceptLabel.textContent='КОНЦЕПЦИЯ РАЗВИТИЯ';cc.append(conceptLabel);
  const categories=[...children[3].children];
  // Trainer: persistent real screenshots, focus changes by position and scale.
  const trainer=scope[4], gallery=q('.content>div:last-child',trainer), trainerCopy=q('.content>div:first-child',trainer);
  gallery.classList.add('m-trainer-gallery');trainerCopy.classList.add('m-trainer-copy');
  const figures=qa('figure',gallery);
  figures.forEach((f,i)=>{f.style.setProperty('--overview-x',`${254*i}px`);const img=q('img',f);const win=document.createElement('div');win.className='m-screen-window';img.before(win);win.append(img);});
  const route=document.createElement('div');route.className='m-route';route.innerHTML='<span></span>';trainer.append(route);
  note(trainer,'Реальные экраны с тестовыми данными. Платежи, связь и продвижение — в плане развития.');
  // Client: preserve the original overview for entry, exit, static view and print.
  const client=scope[5], clientImgs=qa('figure img',client).map(x=>x.src);
  note(client,'Экраны разных тренировок. Сообщество — план развития.');
  const stage=document.createElement('div');stage.className='m-client-stage';stage.setAttribute('aria-hidden','true');
  stage.innerHTML=`
    <section class="m-scene m-voice">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / СОЗДАТЬ</div>
      <h3 class="m-client-title">Голосом<br>или текстом.</h3>
      <p class="m-client-sub">Составляешь программу с ИИ.<br>Сам или с ИИ — под свою цель,<br>время и оборудование.</p>
      <div class="m-input-rule"></div>
      <p class="m-client-note">Постановочная демонстрация ввода, не запись работы ИИ. Упражнение и значения — из экрана итогов 21 сентября 2026.</p>
    </section>
    <section class="m-scene m-loop">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / ЗАПИСАТЬ</div>
      <h3 class="m-client-title">Планируешь. Тренируешься.<br>Видишь прогресс.</h3>
      <div class="m-stations">
        <div class="m-station"><label>01 · План</label><small>Что предстоит сделать</small><div class="m-ghost">Жим гантелей лёжа<br><small>Фрагмент тренировки</small></div></div>
        <div class="m-station"><label>02 · Выполнение</label><small>Запись подходов</small><div class="m-ghost">70 кг<br><small>10 / 12 / 12 повторений</small></div></div>
        <div class="m-station"><label>03 · Завершение</label><small>Сохранённый результат</small></div>
      </div>
      <p class="m-client-note">Постановочная демонстрация одного фрагмента тренировки. Тренер видит результаты и корректирует программу.</p>
    </section>
    <section class="m-scene m-result">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / СРАВНИТЬ</div>
      <h3 class="m-client-title">Видишь, что изменилось.</h3>
      <div class="m-result-screen"><img alt="Исходный экран: результат в жиме гантелей сидя"></div>
      <div class="m-result-data"><h3>Жим гантелей сидя</h3><p>Максимальный вес · сравнение с 18 сентября 2026</p>
        <div class="m-result-bars">
          <div class="m-result-bar"><label>Было<strong>50 кг</strong></label><i style="width:83.333333%"></i></div>
          <div class="m-result-bar"><label>Стало<strong>60 кг</strong></label><i style="width:100%"></i></div>
        </div><div class="m-result-gain">+10 кг</div><p>Показатель из исходного экрана приложения.</p>
      </div>
      <p class="m-client-note">Отдельный пример из приложения, не результат показанного выше фрагмента. Не оценка роста мышц.</p>
    </section>
    <section class="m-scene m-map">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / ПОНЯТЬ</div>
      <h3 class="m-client-title">Твой прогресс.</h3>
      <div class="m-body-screen"><img alt="Исходная карта тела Fit: грудь, результат вырос на 33%"></div>
      <svg class="m-body-line" viewBox="0 0 260 120" aria-hidden="true"><path d="M0 0 H55 Q90 0 90 55 V85 Q90 120 130 120 H260" pathLength="1"/></svg>
      <div class="m-body-data"><h3>Где выросли результаты</h3><div class="m-body-number">+33%</div><p>Грудь · показатель карты тела<br>из исходного экрана Fit.</p><p>Результаты упражнений,<br>а не рост мышц по фотографии.</p></div>
      <p class="m-client-note">Экраны относятся к разным тренировкам и срезам. +33% не приписываем предыдущему примеру.</p>
    </section>
    <div class="m-workout" role="img" aria-label="Постановочная карточка: жим гантелей лёжа, 70 кг, 10 / 12 / 12 повторений">
      <div class="m-workout-head"><div class="m-workout-kicker">ФРАГМЕНТ ТРЕНИРОВКИ</div><h3>Грудь</h3><span class="m-workout-status">План</span></div>
      <div class="m-workout-detail"><strong>Жим гантелей лёжа</strong><div class="m-workout-value"><span>70 кг</span><span>10 / 12 / 12 повторений</span></div><div class="m-sets"><i></i><i></i><i></i></div></div>
      <div class="m-workout-action">Проверить и сохранить →</div>
      <div class="m-workout-complete"><strong>Подходы сохранены</strong><p>Жим гантелей лёжа<br>70 кг · 10 / 12 / 12</p></div>
    </div>
    <span class="m-token">Жим гантелей лёжа</span><span class="m-token value">70 кг</span><span class="m-token value">10 / 12 / 12 повторений</span>`;
  client.append(stage);
  q('.m-result-screen img',stage).src=clientImgs[0];q('.m-body-screen img',stage).src=clientImgs[2];
  const card=q('.m-workout',stage),tokens=qa('.m-token',stage);
  const tokenFrom=[[80,478],[80,540],[250,540]], tokenTo=[[967,423],[967,469],[1038,469]];
  const cardTransforms=['translate(940px,300px) scale(1)','translate(940px,300px) scale(1)','translate(940px,300px) scale(1)','translate(86px,400px) scale(.94)','translate(578px,400px) scale(.94)','translate(1070px,400px) scale(.94)'];
  // Growth: no interpolated metrics; existing cuts and warnings remain exact.
  const growth=scope[6];growth.classList.add('m-growth');
  qa('.meeting-growth-bar-row',growth).forEach((el,i)=>phase(el,i));
  phase(q('.meeting-growth-workouts',growth),3);phase(q('.meeting-growth-bottom',growth),4);
  // Distribution, ecosystem, monetisation: controlled emphasis, not new claims.
  [7,8].forEach(i=>{scope[i].classList.add('m-editorial');qa('.content>div',scope[i]).forEach((el,j)=>phase(el,j));});
  note(scope[8],'Все интеграции — предложения; условия с сервисами не согласованы.');
  qa('.fm1-blk',scope[9]).forEach((el,i)=>phase(el,i));
  const toolbar=document.createElement('nav');toolbar.className='m-toolbar';toolbar.setAttribute('aria-label','Управление motion-презентацией');
  toolbar.innerHTML=`<button data-action="prev" aria-label="Предыдущий шаг">←</button><span class="m-step-counter" aria-live="polite"></span><button data-action="next" aria-label="Следующий шаг">→</button><select aria-label="Перейти к слайду">${all.map((s,i)=>`<option value="${i}">${i?String(i).padStart(2,'0')+' · '+q('h2',s).textContent:'Обложка'}</option>`).join('')}</select><button data-action="play">▶ Автопоказ</button><button data-action="static">Без анимации</button><button data-action="full" aria-label="Полный экран">⛶</button>`;
  document.body.append(toolbar);
  if(params.has('record'))document.body.classList.add('m-recording');
  function renderClient(n, prev, motion) {
    const active=n>0&&n<8;
    client.classList.toggle('m-client-active',active);stage.setAttribute('aria-hidden',String(!active));
    qa('.m-scene',stage).forEach((el,i)=>el.classList.toggle('is-visible',active && (i===0?n<=2:i===1?n>=3&&n<=5:i===2?n===6:n===7)));
    const cardVisible=n>=2&&n<=5;
    card.style.visibility=cardVisible?'visible':'hidden';card.style.opacity=cardVisible?'1':'0';
    const dest=cardTransforms[Math.min(n,5)];card.style.transform=dest;
    if(motion&&cardVisible&&prev>=2&&prev<=5)animate(card,[{transform:cardTransforms[prev]},{transform:dest}],1150);
    else if(motion&&n===2)animate(card,[{opacity:0,transform:dest},{opacity:1,transform:dest}],950);
    q('.m-workout-status',card).textContent=n<4?'План':n===4?'Выполнение':'Завершено';
    q('.m-workout-action',card).textContent=n<3?'Проверить и сохранить →':n===3?'Начать тренировку →':n===4?'Записываем подходы':'Подходы сохранены';
    const detail=q('.m-workout-detail',card);detail.style.opacity=n===2?'1':'1';
    if(motion&&n===2)animate(detail,[{opacity:0,offset:0},{opacity:0,offset:.7},{opacity:1}],1300);
    const complete=q('.m-workout-complete',card);complete.style.opacity=n===5?'1':'0';
    if(motion&&n===5)animate(complete,[{opacity:0},{opacity:1}],1100);
    qa('.m-sets i',card).forEach((el,i)=>{el.classList.toggle('done',n>=4);if(motion&&n===4)animate(el,[{background:'#d6ded0',offset:0},{background:'#d6ded0',offset:i*.22},{background:'#2f6b4f'}],1000);});
    tokens.forEach((el,i)=>{
      const src=`translate(${tokenFrom[i][0]}px,${tokenFrom[i][1]}px) scale(1)`,dst=`translate(${tokenTo[i][0]}px,${tokenTo[i][1]}px) scale(.82)`;
      el.style.transform=n===1?src:dst;el.style.opacity=n===1?'1':'0';el.style.visibility=n===1||n===2?'visible':'hidden';
      if(motion&&prev===1&&n===2)animate(el,[{transform:src,opacity:1},{transform:`translate(${(tokenFrom[i][0]+tokenTo[i][0])/2}px,${(tokenFrom[i][1]+tokenTo[i][1])/2-70}px) scale(.92)`,opacity:1,offset:.5},{transform:dst,opacity:0}],1350);
      if(motion&&prev===2&&n===1)animate(el,[{transform:dst,opacity:0},{transform:src,opacity:1}],1100);
    });
    qa('.m-station',stage).forEach((s,i)=>{s.classList.toggle('is-current',i===n-3);const ghost=q('.m-ghost',s);if(ghost)ghost.style.opacity=i<n-3?'1':'0';});
    if(motion&&n===6)qa('.m-result-bar i',stage).forEach((el,i)=>animate(el,[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],850+i*250));
    const line=q('.m-body-line path',stage);line.style.strokeDasharray='1';line.style.strokeDashoffset='0';
    if(motion&&n===7)animate(line,[{strokeDashoffset:1},{strokeDashoffset:0}],1000);
  }
  function apply(n=step, motion=true, prev=step) {
    step=n;
    toolbar.hidden=index>=10;
    if(index>=10)return updateToolbar();
    const s=scope[index];s.dataset.motionStep=n;
    s.classList.toggle('m-static',staticMode);
    qa('.m-reveal',s).forEach(el=>{const p=+el.dataset.phase;el.classList.toggle('m-pending',!staticMode&&p>n);el.classList.toggle('m-current',!staticMode&&p===n);});
    if(index===0){coverTitle.style.opacity=n||staticMode?'1':'0';if(motion&&n===1)animate(coverTitle,[{clipPath:'inset(20% 100% 33% 0)',opacity:.5},{clipPath:'inset(20% 45% 33% 0)',opacity:1}],1000);}
    if(index===3){
      const spread=[[0,140],[1040,140],[30,355],[1080,355]], gathered=[[0,375],[370,375],[740,375],[1110,375]];
      categories.forEach((el,i)=>{const a=n===0&&!staticMode?spread[i]:gathered[i];el.style.transform=`translate(${a[0]}px,${a[1]}px)`;});
      children[1].style.opacity=n||staticMode?'1':'.12';children[1].style.transform=n||staticMode?'scale(1)':'scale(.9)';
    }
    if(index===4){
      const focus=staticMode||n===0||n===4?-1:n-1;
      figures.forEach((f,i)=>{
        const t=focus<0?`translate(${254*i}px,0) scale(1)`:i===focus?'translate(140px,15px) scale(1.14)':`translate(${i<focus?0:603}px,160px) scale(.48)`;
        f.style.transform=t;f.style.opacity=focus<0||i===focus?'1':'.22';f.style.zIndex=i===focus?'3':'1';
        q('img',f).style.transform='scale(1)';
      });
      qa(':scope>div',trainerCopy).forEach((el,i)=>el.style.opacity=focus<0||i===focus||i===1&&focus===2?'1':'.35');
      q('span',route).style.width=(focus<0?100:(focus+1)/3*100)+'%';
    }
    if(index===5)renderClient(staticMode?8:n,prev,motion&&!staticMode);
    updateToolbar();
  }
  function updateToolbar(){q('.m-step-counter',toolbar).textContent=index<10?`${step+1} / ${max[index]+1}`:'—';q('select',toolbar).value=index;toolbar.title=index<10?labels[index][step]:'';q('[data-action="static"]',toolbar).textContent=staticMode?'Включить анимацию':'Без анимации';q('[data-action="play"]',toolbar).textContent=playing?'Ⅱ Пауза':'▶ Автопоказ';}
  function stop(){playing=false;clearTimeout(timer);timer=null;animations.forEach(a=>a.pause());updateToolbar();}
  function go(i,n=0){settle();index=Math.max(0,Math.min(all.length-1,i));originalShow(index);apply(staticMode&&index<10?max[index]:n,false);}
  function next(manual=true){if(manual)stop();settle();if(index<10&&!staticMode&&step<max[index])apply(step+1,true,step);else if(index<all.length-1)go(index+1);else stop();}
  function prev(){stop();settle();if(index<10&&!staticMode&&step>0)apply(step-1,true,step);else if(index>0)go(index-1,index-1<10?max[index-1]:0);}
  function run(){playing=true;animations.forEach(a=>a.play());updateToolbar();clearTimeout(timer);timer=setTimeout(()=>{if(!playing)return;next(false);if(playing)run();},4200);}
  function full(){document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.().catch(()=>{});}
  function toggleStatic(){stop();settle();staticMode=!staticMode;scope.forEach(s=>s.classList.toggle('m-static',staticMode));apply(staticMode?max[index]||0:0,false);}
  toolbar.addEventListener('click',e=>{const a=e.target.closest('button')?.dataset.action;if(!a)return;({prev,next,play:()=>playing?stop():run(),full,static:toggleStatic})[a]();});
  q('select',toolbar).addEventListener('change',e=>{const target=+e.target.value;stop();go(target);});
  // Capture prevents the original next-slide handlers from skipping motion steps.
  document.addEventListener('click',e=>{const btn=e.target.closest('#prev,#next');if(btn){e.preventDefault();e.stopImmediatePropagation();btn.id==='next'?next():prev();}},true);
  document.addEventListener('keydown',e=>{
    if(e.target.matches('select,input,textarea,button')||e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toLowerCase();
    const actions={arrowright:next,pagedown:next,' ':next,enter:next,arrowleft:prev,pageup:prev,backspace:prev,home:()=>{stop();go(0);},end:()=>{stop();go(all.length-1);},f:full,p:()=>playing?stop():run(),m:toggleStatic,r:()=>{stop();go(index);}};
    if(actions[key]){e.preventDefault();e.stopImmediatePropagation();actions[key]();}
  },true);
  // The original hash listener resolves this function dynamically.
  window.show=(i,hash=true)=>{stop();settle();index=Math.max(0,Math.min(all.length-1,i));originalShow(index,hash);apply(staticMode&&index<10?max[index]:0,false);};
  let beforePrint=null;
  window.addEventListener('beforeprint',()=>{stop();beforePrint={index,step,staticMode};staticMode=true;scope.forEach((s,i)=>{index=i;apply(max[i],false);});index=beforePrint.index;});
  window.addEventListener('afterprint',()=>{if(beforePrint){({index,step,staticMode}=beforePrint);apply(step,false);beforePrint=null;}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.FIT_MOTION={version:1,baseline:'ae7eb6a535cbe385e091745cacd0e08b39249382',max,labels,next,prev,go,play:run,pause:stop,static:toggleStatic,
    state:()=>({index,step,staticMode,playing,animations:animations.size}),
    seek:(i,n=0)=>{stop();go(i,n);},settle,
    ready:()=>Promise.all([...animations].map(a=>a.finished.catch(()=>{})))};
  if(params.has('step'))step=Math.max(0,Math.min(max[index]||0,Number(params.get('step'))||0));
  apply(staticMode&&index<10?max[index]:step,false);
})();
