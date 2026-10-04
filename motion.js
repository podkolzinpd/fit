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
  // Presenter stops, mapped to the existing scene vocabulary. No duplicate final
  // overview stops; numbers, source diagrams and the moving object stay intact.
  const timeline = [[1],[0,1,2],[3,7],[0,1],[1,2,3,4],[0,1,2,3,4,5,6,7],[2,4],[0,4],[0,4],[0,1,2]];
  const max = timeline.map(stops=>stops.length-1);
  const sceneLabels = [
    ['Фотография','Твой спорт. Твоя команда.'],
    ['Для клиента','Для тренера','Масштаб рынка','Вся идея'],
    ['Жители России','15–59 лет','Занимаются спортом','Аудитория Fit','Товары и одежда','Фитнес-услуги','Секции и питание','Устройства и онлайн','Весь рынок'],
    ['Разные приложения','Собираем вокруг Fit','Концепция развития'],
    ['Весь маршрут','Клиент и связь','Программа с ИИ','Расписание и финансы','Поиск тренера'],
    ['Все возможности','Голосом или текстом','Слова → упражнения','План','Выполнение','Завершение','Было → стало','Карта тела','Все возможности'],
    ['14 сентября','20 сентября','4 октября','Записи тренировок','Итог и методика'],
    ['Тренеры и клиенты','Яндекс Плюс','Спортивные события','Обучение тренеров','Экосистема Яндекса','Все каналы'],
    ['Мессенджер · Телемост','Pay · Сплит','Бенефит для компаний','Директ · Практикум','Лавка · Еда · Маркет','Все сценарии'],
    ['Подписка','Комиссия','Реклама','Вся модель']
  ];
  const labels = timeline.map((stops,i)=>stops.map(n=>sceneLabels[i][n]));
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
  // Trainer: fixed context rail; only the selected working fragment is revealed.
  const trainer=scope[4], gallery=q('.content>div:last-child',trainer), trainerCopy=q('.content>div:first-child',trainer);
  trainer.classList.add('m-trainer-lime','m-trainer-four','m-trainer-approved');
  gallery.classList.add('m-trainer-gallery');trainerCopy.classList.add('m-trainer-copy');
  const trainerScreens=['client','ai','finance','marketplace'];
  const trainerCaptions=['Клиент и связь','Программа с ИИ','Расписание и финансы','Поиск тренера'];
  gallery.replaceChildren();
  trainerScreens.forEach((name,i)=>{const f=document.createElement('figure');f.innerHTML=`<div class="m-screen-window"><img src="assets/trainer-approved/${name}.png" alt="Иллюстрация сценария Fit: ${trainerCaptions[i]}. Демонстрационные данные."></div><figcaption><span>0${i+1}</span> ${trainerCaptions[i]}</figcaption>`;gallery.append(f);});
  const figures=qa('figure',gallery);
  const proof=document.createElement('div');proof.className='m-trainer-proof';
  figures.forEach((f,i)=>{
    const panel=document.createElement('figure');panel.className='m-proof-panel';
    const win=document.createElement('div');win.className='m-proof-window';win.append(q('img',f).cloneNode());panel.append(win);
    panel.classList.add(`m-proof-${trainerScreens[i]}`);
    if(i===1){
      const video=document.createElement('video');video.className='m-trainer-exercise-video';
      video.src='assets/trainer-approved/ai.mp4';video.poster='assets/trainer-approved/ai.png';
      video.muted=true;video.loop=true;video.playsInline=true;video.preload='metadata';
      video.setAttribute('aria-label','Программа с ИИ: анимации упражнений из каталога Fit');
      video.addEventListener('playing',()=>video.classList.add('is-playing'));
      video.addEventListener('error',()=>video.classList.remove('is-playing'));
      win.append(video);
    }
    proof.append(panel);
  });gallery.append(proof);
  const route=document.createElement('div');route.className='m-route';route.innerHTML='<span></span>';trainer.append(route);
  // Concept/demonstration status remains in alt text and presenter notes, not in
  // the visible footer. The user approved these four visual scenarios in chat.
  const trainerNotes=q('.speaker-notes',trainer);
  if(trainerNotes)trainerNotes.append(document.createTextNode(' Экраны — согласованные иллюстрации сценариев с демонстрационными данными и вымышленными портретами. Анимации упражнений — из каталога приложения Fit.'));
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
      <div class="m-utterance"><div class="m-utterance-name"></div><div class="m-utterance-values"></div></div>
      <p class="m-client-note">Демонстрация ввода · данные из итогов 21.09.2026 · не запись работы ИИ.</p>
    </section>
    <section class="m-scene m-loop">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / ЗАПИСАТЬ</div>
      <h3 class="m-client-title">Планируешь. Тренируешься.<br>Видишь прогресс.</h3>
      <div class="m-stations">
        <div class="m-station"><label>01 · План</label><small>Что предстоит сделать</small><div class="m-ghost">Жим гантелей лёжа<br><small>Фрагмент тренировки</small></div></div>
        <div class="m-station"><label>02 · Выполнение</label><small>Запись подходов</small><div class="m-ghost">70 кг<br><small>10 / 12 / 12 повторений</small></div></div>
        <div class="m-station"><label>03 · Завершение</label><small>Сохранённый результат</small></div>
      </div>
      <p class="m-client-note">Демонстрация фрагмента тренировки. Результаты доступны тренеру для корректировки программы.</p>
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
      <p class="m-client-note">Отдельная тренировка · сравниваем рабочий вес, не рост мышц.</p>
    </section>
    <section class="m-scene m-map">
      <div class="m-client-eyebrow">05 · ДЛЯ КЛИЕНТА / ПОНЯТЬ</div>
      <h3 class="m-client-title">Твой прогресс.</h3>
      <div class="m-body-screen"><img alt="Исходная карта тела Fit: грудь, результат вырос на 33%"></div>
      <svg class="m-body-line" viewBox="0 0 260 120" aria-hidden="true"><path d="M0 0 H55 Q90 0 90 55 V85 Q90 120 130 120 H260" pathLength="1"/></svg>
      <div class="m-body-data"><h3>Карта тела — отдельный срез</h3><p>Результаты упражнений<br>по группам мышц.</p><p class="m-map-caption">Пример из приложения Fit.</p></div>
      <p class="m-client-note">Отдельный срез · не результат предыдущего примера и не оценка роста мышц.</p>
    </section>
    <div class="m-workout" role="img" aria-label="Постановочная карточка: жим гантелей лёжа, 70 кг, 10 / 12 / 12 повторений">
      <div class="m-workout-head"><div class="m-workout-kicker">ФРАГМЕНТ ТРЕНИРОВКИ</div><h3>Грудь</h3><span class="m-workout-status">План</span></div>
      <div class="m-workout-detail"><div class="m-slot-name"></div><div class="m-workout-value"><span class="m-slot-weight"></span><span class="m-slot-reps"></span></div><div class="m-sets"><i><small>1-й подход</small><b>10</b><span>повторений</span></i><i><small>2-й подход</small><b>12</b><span>повторений</span></i><i><small>3-й подход</small><b>12</b><span>повторений</span></i></div></div>
      <div class="m-workout-action">Проверить и сохранить →</div>
    </div>
    <span class="m-token">Жим гантелей лёжа</span><span class="m-token value">70 кг</span><span class="m-token value">10 / 12 / 12 повторений</span>`;
  client.append(stage);
  q('.m-result-screen img',stage).src=clientImgs[0];q('.m-body-screen img',stage).src=clientImgs[2];
  const card=q('.m-workout',stage),tokens=qa('.m-token',stage);
  const tokenHomes=[q('.m-utterance-name',stage),q('.m-utterance-values',stage),q('.m-utterance-values',stage)];
  const tokenSlots=[q('.m-slot-name',card),q('.m-slot-weight',card),q('.m-slot-reps',card)];
  const cardTransforms=['translate(930px,285px) scale(1)','translate(930px,285px) scale(1)','translate(930px,285px) scale(1)','translate(86px,395px) scale(.82)','translate(578px,395px) scale(.82)','translate(1070px,395px) scale(.82)'];
  function placeTokens(n,prev,motion){
    const targets=n>=2?tokenSlots:tokenHomes;
    const before=tokens.map(el=>el.getBoundingClientRect());
    tokens.forEach((el,i)=>targets[i].append(el));
    if(motion&&((prev===1&&n===2)||(prev===2&&n===1))){
      const scale=stage.getBoundingClientRect().width/1600;
      tokens.forEach((el,i)=>{
        const after=el.getBoundingClientRect(),dx=(before[i].left-after.left)/scale,dy=(before[i].top-after.top)/scale;
        animate(el,[{transform:`translate(${dx}px,${dy}px)`},{transform:`translate(${dx*.48}px,${dy*.48-36}px)`,offset:.5},{transform:'translate(0,0)'}],1050);
      });
    }
  }
  // Growth: no interpolated metrics; existing cuts and warnings remain exact.
  const growth=scope[6];growth.classList.add('m-growth');
  qa('.meeting-growth-bar-row',growth).forEach((el,i)=>phase(el,i));
  phase(q('.meeting-growth-workouts',growth),3);phase(q('.meeting-growth-bottom',growth),4);
  // Distribution, ecosystem, monetisation: controlled emphasis, not new claims.
  [7,8].forEach(i=>{scope[i].classList.add('m-editorial');qa('.content>div',scope[i]).forEach((el,j)=>phase(el,j));});
  note(scope[8],'Все интеграции — предложения; условия с сервисами не согласованы.');
  // Practicum already has its own explanation on the acquisition slide.
  const direct=qa('.content h3',scope[8]).find(el=>el.textContent.includes('Директ'));
  if(direct)direct.textContent='Директ';
  const acquisition=q('.content>div:first-child p',scope[7]);
  acquisition.innerHTML=acquisition.innerHTML.replace('Личные договорённости с клубами и тренерами. Уже есть договорённость со <strong>Spirit — 47 клубов</strong>.','Личные договорённости с клубами и тренерами.<span class="m-spirit-line">Есть договорённость: <strong>Spirit — 47 клубов</strong>.</span>');
  const commission=qa('.fm1-blk',scope[9])[1];
  scope[9].dataset.notes+=' Полное пояснение комиссии: '+q('.fm1-how',commission).textContent;
  q('.fm1-how',commission).innerHTML='Оплата тренировки или программы через Fit.<br>Деньги тренеру — после подтверждения.<br>При споре Fit разбирает ситуацию.<br>За это удерживает комиссию.';
  // Only the agreed photographic framing changes on the team slide. Source
  // photographs, roles, dates and staffing values are not altered.
  all[13].classList.add('motion-team-framing');
  qa('.fm1-blk',scope[9]).forEach((el,i)=>phase(el,i));
  const toolbar=document.createElement('nav');toolbar.className='m-toolbar';toolbar.setAttribute('aria-label','Управление motion-презентацией');
  toolbar.innerHTML=`<button data-action="prev" aria-label="Предыдущий шаг">←</button><span class="m-step-counter" aria-live="polite"></span><button data-action="next" aria-label="Следующий шаг">→</button><select aria-label="Перейти к слайду">${all.map((s,i)=>`<option value="${i}">${i?String(i).padStart(2,'0')+' · '+q('h2',s).textContent:'Обложка'}</option>`).join('')}</select><button data-action="play">▶ Автопоказ</button><button data-action="static">Без анимации</button><button data-action="full" aria-label="Полный экран">⛶</button>`;
  document.body.append(toolbar);
  if(params.has('record'))document.body.classList.add('m-recording');
  function renderClient(n, prev, motion) {
    const active=n>0&&n<8;
    client.classList.toggle('m-client-active',active);stage.setAttribute('aria-hidden',String(!active));
    qa('.m-scene',stage).forEach((el,i)=>el.classList.toggle('is-visible',active && (i===0?n<=2:i===1?n>=3&&n<=5:i===2?n>=6:n===7)));
    stage.classList.toggle('m-map-context',n===7);
    const resultData=q('.m-result-data',stage),previousData=resultData.getBoundingClientRect();
    resultData.classList.toggle('m-result-compact',n===7);
    const cardVisible=n>=2&&n<=5;
    card.style.visibility=cardVisible?'visible':'hidden';card.style.opacity=cardVisible?'1':'0';
    const dest=cardTransforms[Math.min(n,5)];card.style.transform=dest;
    if(motion&&cardVisible&&prev>=2&&prev<=5)animate(card,[{transform:cardTransforms[prev]},{transform:dest}],900);
    q('.m-workout-status',card).textContent=n<4?'План':n===4?'Выполнение':'Завершено';
    q('.m-workout-action',card).textContent=n<3?'Проверить и сохранить →':n===3?'Начать тренировку →':n===4?'Записываем подходы':'✓ Подходы сохранены';
    card.classList.toggle('m-card-complete',n===5);
    placeTokens(n,prev,motion);
    qa('.m-sets i',card).forEach((el,i)=>{el.classList.toggle('done',n>=4);if(motion&&n===4)animate(el,[{background:'#f0f2ed',color:'#596166',offset:0},{background:'#f0f2ed',color:'#596166',offset:.45+i*.15},{background:'#e0ecdf',color:'#2f6b4f'}],1300);});
    qa('.m-station',stage).forEach((s,i)=>{s.classList.toggle('is-current',i===n-3);const ghost=q('.m-ghost',s);if(ghost)ghost.style.opacity=i<n-3?'1':'0';});
    if(motion&&n===6&&prev!==7){
      qa('.m-result-bar i',stage).forEach(el=>animate(el,[{transform:'scaleX(0)'},{transform:'scaleX(1)'}],600));
      animate(q('.m-result-gain',stage),[{opacity:0,offset:0},{opacity:0,offset:.65},{opacity:1}],900);
    }
    if(motion&&((n===7&&prev===6)||(n===6&&prev===7))){
      const after=resultData.getBoundingClientRect(),scale=stage.getBoundingClientRect().width/1600;
      animate(resultData,[{transform:`translate(${(previousData.left-after.left)/scale}px,${(previousData.top-after.top)/scale}px)`},{transform:'none'}],450);
    }
    const line=q('.m-body-line path',stage);line.style.strokeDasharray='1';line.style.strokeDashoffset='0';
    if(motion&&n===7){
      animate(q('.m-body-screen',stage),[{opacity:0,offset:0},{opacity:0,offset:.45},{opacity:1}],900);
      animate(q('.m-body-data',stage),[{opacity:0,offset:0},{opacity:0,offset:.6},{opacity:1}],1050);
      animate(line,[{strokeDashoffset:1,offset:0},{strokeDashoffset:1,offset:.7},{strokeDashoffset:0}],1400);
    }
  }
  function apply(n=step, motion=true, prev=step) {
    step=n;
    qa('video',proof).forEach(v=>{v.pause();v.classList.remove('is-playing');});
    toolbar.hidden=index>=10;
    if(index>=10)return updateToolbar();
    const s=scope[index];s.dataset.motionStep=n;
    const scene=timeline[index][n],previousScene=timeline[index][prev];
    s.classList.toggle('m-static',staticMode);
    qa('.m-reveal',s).forEach(el=>{const p=+el.dataset.phase;el.classList.toggle('m-pending',!staticMode&&p>scene);el.classList.toggle('m-current',!staticMode&&p===scene);});
    if(index===0){coverTitle.style.opacity='1';}
    if(index===3){
      const spread=[[0,140],[1040,140],[30,355],[1080,355]], gathered=[[0,375],[370,375],[740,375],[1110,375]];
      categories.forEach((el,i)=>{const a=n===0&&!staticMode?spread[i]:gathered[i];el.style.transform=`translate(${a[0]}px,${a[1]}px)`;});
      children[1].style.opacity=n||staticMode?'1':'.12';children[1].style.transform=n||staticMode?'scale(1)':'scale(.9)';
    }
    if(index===4){
      const focus=staticMode||scene===0?-1:scene-1;
      trainer.classList.toggle('m-trainer-overview',focus<0);
      figures.forEach((f,i)=>{
        f.style.transform=focus<0?`translate(${i%2*390}px,${Math.floor(i/2)*380}px)`:`translate(520px,${i*183}px)`;
        f.style.opacity=focus<0||i===focus?'1':'.62';
        f.classList.toggle('m-context-current',i===focus);
      });
      qa('.m-proof-panel',proof).forEach((el,i)=>{
        el.classList.toggle('is-visible',i===focus);el.setAttribute('aria-hidden',String(i!==focus));
        if(i===focus&&motion&&previousScene!==scene)animate(el,[{opacity:0},{opacity:1}],380);
      });
      qa(':scope>div',trainerCopy).forEach((el,i)=>el.style.opacity=focus<0||i===focus?'1':'.7');
      q('span',route).style.width=(focus<0?100:(focus+1)/4*100)+'%';
      if(focus===1&&!document.hidden){const video=q('video',proof);video.play().catch(()=>video.classList.remove('is-playing'));}
    }
    if(index===5)renderClient(staticMode?8:scene,previousScene,motion&&!staticMode);
    updateToolbar();
  }
  function updateToolbar(){q('.m-step-counter',toolbar).textContent=index<10?`${step+1} / ${max[index]+1}`:'—';q('select',toolbar).value=index;toolbar.title=index<10?labels[index][step]:'';q('[data-action="static"]',toolbar).textContent=staticMode?'Включить анимацию':'Без анимации';q('[data-action="play"]',toolbar).textContent=playing?'Ⅱ Пауза':'▶ Автопоказ';}
  function stop(){playing=false;clearTimeout(timer);timer=null;settle();updateToolbar();}
  function revealCover(){if(index===0&&!staticMode)animate(coverTitle,[{clipPath:'inset(20% 100% 33% 0)',opacity:.5},{clipPath:'inset(20% 45% 33% 0)',opacity:1}],850);}
  function go(i,n=0){settle();index=Math.max(0,Math.min(all.length-1,i));originalShow(index);apply(staticMode&&index<10?max[index]:n,false);revealCover();}
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
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toLowerCase();
    // Keep native field/button interactions, but never leak their keys to the
    // legacy slide-level handler (which otherwise skips the current motion).
    if(e.target.closest('select,input,textarea,[contenteditable="true"]')){e.stopImmediatePropagation();return;}
    if(e.target.closest('button')&&(key===' '||key==='enter')){e.stopImmediatePropagation();return;}
    const actions={arrowright:next,pagedown:next,' ':next,enter:next,arrowleft:prev,pageup:prev,backspace:prev,home:()=>{stop();go(0);},end:()=>{stop();go(all.length-1);},f:full,p:()=>playing?stop():run(),m:toggleStatic,r:()=>{stop();go(index);}};
    if(actions[key]){e.preventDefault();e.stopImmediatePropagation();actions[key]();}
  },true);
  // The original hash listener resolves this function dynamically.
  window.show=(i,hash=true)=>{stop();settle();index=Math.max(0,Math.min(all.length-1,i));originalShow(index,hash);apply(staticMode&&index<10?max[index]:0,false);revealCover();};
  let beforePrint=null;
  window.addEventListener('beforeprint',()=>{stop();beforePrint={index,step,staticMode};staticMode=true;scope.forEach((s,i)=>{index=i;apply(max[i],false);});index=beforePrint.index;});
  window.addEventListener('afterprint',()=>{if(beforePrint){({index,step,staticMode}=beforePrint);apply(step,false);beforePrint=null;}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();qa('video',proof).forEach(v=>v.pause());}else if(index===4&&!staticMode&&step===1){q('video',proof).play().catch(()=>{});}});
  window.FIT_MOTION={version:3,baseline:'ae7eb6a535cbe385e091745cacd0e08b39249382',iterationBaseline:'d8bf8f0a7a8228490c80b66ba8567d2b9b851f14',max,labels,next,prev,go,play:run,pause:stop,static:toggleStatic,
    state:()=>({index,step,staticMode,playing,animations:animations.size}),
    seek:(i,n=0)=>{stop();go(i,n);},settle,
    ready:()=>Promise.all([...animations].map(a=>a.finished.catch(()=>{})))};
  if(params.has('step'))step=Math.max(0,Math.min(max[index]||0,Number(params.get('step'))||0));
  apply(staticMode&&index<10?max[index]:step,false);
  revealCover();
})();
