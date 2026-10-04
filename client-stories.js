/* Three scoped client scenarios. Illustrative data, no live microphone or API calls. */
(() => {
  const anchor=window.FIT_CLIENT_AI_PHONE?.slide;
  if(!anchor)return;
  const arrow='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  const mic='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
  const heart='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>';
  const portrait='<span class="cs-coach-photo" role="img" aria-label="Иллюстративный портрет тренера Ирины"><img src="assets/trainer-approved/marketplace.png" alt=""></span>';
  const status='<div class="cs-status" aria-hidden="true"><span>9:41</span><svg viewBox="0 0 46 16"><path d="M1 13h3V9H1zm5 0h3V6H6zm5 0h3V2h-3z" fill="currentColor" stroke="none"/><rect x="23" y="3" width="19" height="10" rx="2" fill="none" stroke="currentColor"/><path d="M44 6v4" stroke="currentColor"/><rect x="25" y="5" width="15" height="6" rx="1" fill="currentColor" stroke="none"/></svg></div>';
  const phone=(title,body,extra='')=>`<div class="cs-phone ${extra}" role="group" aria-label="Иллюстрация интерфейса Fit">${status}<header class="cs-app-head"><span>‹</span><strong>${title}</strong><i>ФИТ</i></header><div class="cs-phone-body">${body}</div><div class="cs-home" aria-hidden="true"></div></div>`;
  const steps=(labels)=>`<ol class="cs-steps" aria-label="Шаги сценария">${labels.map((x,i)=>`<li><button data-cs-step="${i}"><span>0${i+1}</span>${x}</button></li>`).join('')}</ol>`;
  const baseNote='Презентационная иллюстрация с вымышленными данными, не запись реального действия пользователя. Чёрно-лаймовые поверхности, капсульные кнопки и карточки адаптированы из текущего Fit Lime. Портреты и социальные фотографии — иллюстративные; не свидетельства реальных клиентов. ';
  let tail=anchor;
  const stories=[];
  function create(kind,title,lead,revision,body,notes){
    const slide=document.createElement('section');slide.className=`slide client-ai-story client-story cs-${kind}`;
    slide.dataset.section=`05 · ДЛЯ КЛИЕНТА · ${kind==='voice'?'ЗАПИСЬ':kind==='coach'?'ТРЕНЕР':'СООБЩЕСТВО'}`;
    slide.dataset.version=`6.${revision}`;slide.dataset.slideType='product-flow';slide.dataset.golden='linear/03-linear-product-flow.png';
    slide.innerHTML=`<div class="eyebrow"><span class="design-number">05</span> · ДЛЯ КЛИЕНТА</div><h2>${title}</h2><p class="cs-lead">${lead}</p>${body}<aside class="speaker-notes">${baseNote}${notes}</aside>`;
    tail.after(slide);tail=slide;
    slide.addEventListener('click',e=>{const button=e.target.closest('[data-cs-step]');if(button&&window.FIT_MOTION)FIT_MOTION.seek([...document.querySelectorAll('#deck>.slide')].indexOf(slide),+button.dataset.csStep);});
    return slide;
  }
  const sets=`<table class="cs-set-table"><thead><tr><th>Подход</th><th>Вес, кг</th><th>Повторы</th><th></th></tr></thead><tbody>${[1,2,3].map(i=>`<tr><td>${i}</td><td>60</td><td>10</td><td class="cs-check">✓</td></tr>`).join('')}</tbody></table>`;
  const wave=Array.from({length:35},(_,i)=>`<i style="--h:${[18,32,58,25,76,44,92,62,35,78,105,64,85,50,96,120,80,44,91,66,102,51,77,39,94,60,32,69,45,83,29,55,37,23,15][i]}px"></i>`).join('');
  const voice=create('voice','Записываешь тренировку<br>голосом или текстом','Рассказываешь, что сделал. Fit разбирает запись по упражнениям и подходам.',4,`
    <div class="cs-dictation"><div class="cs-record-label">${mic}<span>Запись тренировки</span><small>00:08</small></div><div class="cs-wave" aria-hidden="true">${wave}</div><blockquote>«Жим ногами —<br>три подхода по десять,<br><em>шестьдесят килограммов</em>»</blockquote><button class="cs-pill" data-cs-step="1">Готово ${arrow}</button><span class="cs-text-alternative">Можно записать текстом</span></div>
    <div class="cs-voice-result" aria-hidden="true" inert><div class="cs-voice-recap"><span class="cs-kicker">ТВОЯ ЗАПИСЬ</span><p>Жим ногами —<br>3 подхода × 10,<br>60 кг</p><span class="cs-recap-note">Остаётся проверить<br>и сохранить</span></div>${phone('Тренировка',`<div class="cs-app-label">Сегодня · самостоятельно</div><h3>Запись готова</h3><div class="cs-exercise"><img src="assets/client-ai/leg-press-machine.jpg" alt="Жим ногами из каталога Fit"><div><h4>Жим ногами</h4><p>3 подхода</p></div></div>${sets}<div class="cs-source"><span>Исходный текст</span><p>Жим ногами — три подхода по десять, шестьдесят килограммов.</p></div><div class="cs-bottom"><div class="cs-pill">Сохранить тренировку ${arrow}</div></div>`)}</div>${steps(['Надиктовал','Проверил запись'])}`,
    'Голос → структурированная запись: два состояния, одно нажатие. Пример 60 кг / 3×10 не является рекомендацией нагрузки. Источники поведения: QuickWorkoutEntry.tsx, VoiceInputButton.tsx, WorkoutSetTable.tsx. Обязательная проверка перед сохранением остаётся видимой. Микрофон не активируется. Композиция linear/03: один вход и один результат, без цепочки промежуточных карточек.');
  stories.push({slide:voice,stops:[0,1],labels:['Голосом или текстом','Готовая запись'],pause(){},render(n,motion,animate,still){
    const previous=+(voice.dataset.csStep||0);voice.dataset.csStep=n;
    const a=voice.querySelector('.cs-dictation'),b=voice.querySelector('.cs-voice-result');
    [a,b].forEach((el,i)=>{el.setAttribute('aria-hidden',String(i!==n));el.inert=i!==n;});
    voice.querySelector('.cs-lead').textContent=n?'Проверяешь подходы и сохраняешь тренировку. Вводить каждое число отдельно не нужно.':'Рассказываешь, что сделал. Fit разбирает запись по упражнениям и подходам.';
    if(motion&&n!==previous){animate(n?b:a,[{opacity:0,transform:`translateY(${n?28:-18}px)`},{opacity:1,transform:'none'}],600);}
    markSteps(voice,n);
  }});
  const coach=create('coach','Занимаешься<br>с тренером','Тренер видит результаты и помогает скорректировать занятия.',5,`
    ${phone('Моя тренировка',`<div class="cs-app-label">Сегодня · с тренером</div><h3>Тренировка завершена</h3><div class="cs-session-summary"><span><b>45</b>минут</span><span><b>3</b>упражнения</span><span><b>9</b>подходов</span></div><div class="cs-exercise"><img src="assets/client-ai/leg-press-machine.jpg" alt="Жим ногами из каталога Fit"><div><h4>Жим ногами</h4><p>60 кг · 3 × 10</p></div></div><div class="cs-compact-exercise"><img src="assets/client-ai/romanian-deadlift.jpg" alt="Румынская тяга из каталога Fit"><span>Румынская тяга<small>3 подхода выполнено</small></span><b>✓</b></div><div class="cs-compact-exercise"><img src="assets/client-ai/pec-deck.jpg" alt="Сведение рук из каталога Fit"><span>Сведение рук<small>3 подхода выполнено</small></span><b>✓</b></div><div class="cs-client-note"><span>Твой комментарий</span><p>Последний подход дался тяжело, но все повторы сделал.</p></div><div class="cs-shared">✓ Результат доступен тренеру</div>`)}
    <div class="cs-coach-link" aria-hidden="true"></div><div class="cs-feedback" aria-hidden="true" inert><div class="cs-coach-person">${portrait}<div><h3>Ирина Ковалёва</h3><span>Твой тренер</span></div></div><div class="cs-feedback-message"><span>К тренировке · сегодня</span><p>Вижу, все подходы записаны. На следующем занятии обсудим, как далась нагрузка, и скорректируем план.</p></div></div>${steps(['Результат занятия','Комментарий тренера'])}`,
    'Комментарий тренера — согласованная концепция связи, не утверждение о текущей доступности чата. Действующий WorkoutCompletionReport.tsx показывает «Результат доступен тренеру». Вымышленная Ирина Ковалёва и её портрет взяты из ранее согласованного marketplace-макета. Одна демонстрационная реплика появляется и остаётся, без увеличения и возврата. Композиция linear/03: главный клиентский экран и один меньший ответ тренера.');
  stories.push({slide:coach,stops:[0,1],labels:['Результат занятия','Комментарий тренера'],pause(){},render(n,motion,animate){
    const previous=+(coach.dataset.csStep||0);coach.dataset.csStep=n;const card=coach.querySelector('.cs-feedback');card.setAttribute('aria-hidden',String(!n));card.inert=!n;
    if(n&&motion&&previous!==n)animate(card,[{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'none'}],420);
    markSteps(coach,n);
  }});
  const post=(name,initial,meta,photo,alt,caption,likes,challenge='')=>`<article class="cs-post"><header><span class="cs-avatar">${initial}</span><div><strong>${name}</strong><span>${meta}</span></div><span class="cs-post-more">···</span></header><img class="cs-post-photo" src="assets/client-stories/${photo}.png" alt="${alt}"><div class="cs-post-copy"><p>${caption}</p>${challenge}<div class="cs-reactions">${heart}<span>${likes}</span><span class="cs-comment-icon">◯</span><span>Обсудить</span></div></div></article>`;
  const community=create('community','Тренируешься<br>вместе с сообществом','Делишься тренировками, поддерживаешь друзей и участвуешь в челленджах.',6,`
    <div class="cs-community-tags"><span>Зал</span><span>Бег</span><span>Велосипед</span></div>
    ${phone('Сообщество',`<div class="cs-feed-tabs"><span class="selected">Лента</span><span>Челленджи</span></div><div class="cs-feed-window"><div class="cs-feed-track">
    ${post('Анна','А','Сегодня · силовая','gym','Иллюстративное фото: спортсменка после занятия в современном зале','Тренировка закончена. Хорошо, что сегодня дошла до зала.',12)}
    ${post('Алексей','А','Сегодня · велосипед','bike','Иллюстративное фото: велосипедист на прогулке','Выбрались на набережную. Отличный маршрут на выходной.',18)}
    ${post('Мария','М','Сегодня · пробежка','run','Иллюстративное фото: двое друзей бегут в осеннем парке','Пробежали вместе. Третья тренировка за неделю!',24,'<div class="cs-challenge"><span>ЧЕЛЛЕНДЖ</span><strong>3 тренировки за неделю</strong><div class="cs-challenge-progress"><i></i></div><small>3 из 3 · Выполнено ✓</small></div>')}
    </div></div><div class="cs-feed-nav"><span>Главная</span><strong>Сообщество</strong><span>Профиль</span></div>`)}${steps(['Лента друзей','Участие в челлендже'])}`,
    'Сообщество, лента и челленджи — концепция развития Fit. Имена, публикации, счётчики, результат челленджа вымышлены. Фото созданы встроенной генерацией изображений: зал, бег, велосипед; внешность мужчины на пробежке и зал изменены по запросу пользователя. Один прокрут до публикации с челленджем, затем неподвижный кадр. Стиль поверхности заимствован у текущих компонентов Fit, не выдается за реальный скриншот готовой ленты. Композиция linear/02: одна крупная продуктовая поверхность, текст вторичен.');
  let scrollAnimation=null;
  stories.push({slide:community,stops:[0,1],labels:['Лента друзей','Челлендж выполнен'],pause(){scrollAnimation?.finish();scrollAnimation=null;},render(n,motion,animate){
    const previous=+(community.dataset.csStep||0);community.dataset.csStep=n;
    const track=community.querySelector('.cs-feed-track'),posts=[...track.children];const offset=posts[2].offsetTop;
    const from=previous?-offset:0,to=n?-offset:0;track.style.transform=`translateY(${to}px)`;
    posts.forEach((p,i)=>{p.setAttribute('aria-hidden',String(n?i!==2:i===2));});
    if(motion&&n!==previous)scrollAnimation=animate(track,[{transform:`translateY(${from}px)`},{transform:`translateY(${to}px)`}],1600);
    markSteps(community,n);
  }});
  function markSteps(slide,n){slide.querySelectorAll('.cs-steps button').forEach((b,i)=>b.setAttribute('aria-current',i===n?'step':'false'));}
  window.FIT_CLIENT_STORIES=stories;
})();
