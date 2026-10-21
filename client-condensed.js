/* Approved client sequence. Reuse the existing UI; archive superseded scenes. */
(() => {
  const ai=window.FIT_CLIENT_AI_PHONE, stories=window.FIT_CLIENT_STORIES;
  if(!ai||!stories)return;
  const find=c=>stories.find(s=>s.slide.matches(c));
  const coach=find('.cs-coach'),progress=find('.pm-trend'),food=find('.cs-nutrition');
  const voice=find('.cs-voice'),community=find('.cs-community');
  const archive=document.createElement('template');archive.id='client-scenes-reserve';
  document.body.append(archive);
  const base=document.createElement('section');
  base.className='slide client-ai-story client-story client-base';
  base.dataset.section='05 · ДЛЯ СПОРТСМЕНА';base.dataset.version='6.10';
  base.dataset.slideType='product-flow';base.dataset.golden='linear/03-linear-product-flow.png';
  const names=['Работа самостоятельно или с тренером','Прогресс и достижения','Питание'];
  const copy=['Находишь тренера или добавляешь своего.<br>Он видит результаты и корректирует занятия.','Следишь за результатами и нагрузкой на мышцы.<br>Отмечаешь свои достижения.','Все приёмы пищи — в одном дневнике.<br>Калории за день видны тебе и тренеру.'];
  base.innerHTML='<div class="eyebrow"><span class="design-number">05</span> · ДЛЯ СПОРТСМЕНА</div><h2>Твои тренировки —<br>в системе</h2><div class="cb-list">'+names.map((name,i)=>`<button class="cb-item" data-base-step="${i}"><strong>${name}</strong><span>${copy[i]}</span></button>`).join('')+'</div>';
  ai.slide.before(base);
  const panels=[coach,progress,food].map((story,i)=>{
    story.render(i===2?1:0,false,()=>null,true);
    const panel=document.createElement('div');
    panel.className='cb-panel '+story.slide.className.replace(/\bslide\b|\bactive\b|\bclient-ai-story\b/g,'');
    panel.dataset.csStep=i===2?'1':'0';
    panel.append(story.slide.querySelector('.cs-phone').cloneNode(true));
    if(i===1){
      const badge=document.createElement('div');badge.className='cb-achievement';
      badge.innerHTML='<img src="assets/progress-month/workouts-10.webp" alt=""><div>Десятка тренировок<small>10 из 10 · Получено</small></div>';
      panel.querySelector('.cs-phone-body').append(badge);
    }
    base.append(panel);
    const note=story.slide.querySelector('.speaker-notes');if(note)base.append(note.cloneNode(true));
    return panel;
  });
  const baseStory={slide:base,stops:[0,1,2],labels:names,pause(){},render(n){
    base.dataset.baseStep=n;
    panels.forEach((panel,i)=>{panel.hidden=i!==n;panel.inert=i!==n;panel.setAttribute('aria-hidden',String(i!==n));});
    base.querySelectorAll('.cb-item').forEach((b,i)=>b.setAttribute('aria-current',i===n?'step':'false'));
  }};
  base.addEventListener('click',e=>{const b=e.target.closest('[data-base-step]');if(b)window.FIT_MOTION?.transitionTo([...document.querySelectorAll('#deck>.slide')].indexOf(base),+b.dataset.baseStep);});
  baseStory.render(0);
  for(const story of stories)if(story!==voice&&story!==community)archive.content.append(story.slide);
  base.after(voice.slide);voice.slide.after(ai.slide);ai.slide.after(community.slide);
  ai.stops=[0,1];ai.labels=['Твоя цель','Готовая программа'];
  ai.slide.querySelector('[data-ca-step="2"]')?.remove();
  voice.slide.classList.add('client-technology');
  voice.slide.querySelector('h2').innerHTML='План и запись<br>тренировки';
  const tech=document.createElement('div');tech.className='ct-copy';
  tech.innerHTML='<section><h3>Голосом или текстом</h3><p>Рассказываешь, что сделал.<br>FIT разбирает запись по упражнениям и подходам.</p></section><section><h3>Самостоятельно или с ИИ</h3><p>Составляешь программу сам или с ИИ —<br>с учётом целей и прошлых тренировок.</p></section>';
  voice.slide.dataset.techFocus='voice';
  voice.slide.append(tech);
  ai.slide.classList.add('client-technology');
  ai.slide.dataset.techFocus='ai';
  ai.slide.querySelector('h2').innerHTML='План и запись<br>тренировки';
  ai.slide.append(tech.cloneNode(true));
  window.FIT_CLIENT_AI_PHONE=baseStory;
  window.FIT_CLIENT_STORIES=[voice,ai,community];
  [voice,ai,community].forEach(({slide})=>{
    slide.dataset.section=slide.dataset.section.replace('ДЛЯ КЛИЕНТА','ДЛЯ СПОРТСМЕНА');
    const eyebrow=slide.querySelector('.eyebrow');
    if(eyebrow)eyebrow.innerHTML=eyebrow.innerHTML.replace('ДЛЯ КЛИЕНТА','ДЛЯ СПОРТСМЕНА');
  });
  document.addEventListener('DOMContentLoaded',()=>panels.forEach((panel,i)=>{
    const selected=['calendar','progress','home'][i];
    panel.querySelectorAll('.du-nav [data-tab]').forEach(t=>{const on=t.dataset.tab===selected;t.classList.toggle('active',on);if(on)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');});
  }));
})();
