/* Approved two-state nutrition storyboard. Illustrative values, no intake advice. */
(() => {
  const stories=window.FIT_CLIENT_STORIES;
  const index=stories?.findIndex(s=>s.slide.classList.contains('cs-coach'));
  if(index==null||index<0)return;
  const slide=document.createElement('section');
  slide.className='slide client-ai-story client-story cs-nutrition';
  slide.dataset.section='05 · ДЛЯ КЛИЕНТА · ПИТАНИЕ';
  slide.dataset.version='6.7';slide.dataset.slideType='product-flow';
  slide.dataset.golden='linear/03-linear-product-flow.png';
  const row=(name,qty,kcal)=>`<div class="fn-row"><span>${name}<small>${qty}</small></span><b>${kcal} ккал</b><i>›</i></div>`;
  slide.innerHTML=`<div class="eyebrow"><span class="design-number">05</span> · ДЛЯ КЛИЕНТА</div>
    <h2>Записываешь питание<br>Видишь итог за день</h2>
    <p class="cs-lead">Добавляешь еду и порции.<br>ФИТ считает калории и сохраняет запись в дневнике.</p>
    <div class="cs-phone" role="group" aria-label="Дневник питания ФИТ">
      <div class="cs-status"><span>9:41</span><span>▮▮▮ ▰</span></div>
      <header class="cs-app-head"><span>‹</span><strong>Питание</strong><i>ФИТ</i></header>
      <div class="cs-phone-body">
        <section class="fn-state fn-entry"><div class="fn-subtitle">Добавить ужин</div>
          <div class="fn-food" role="img" aria-label="Рыба, картофель и овощи"></div>
          ${row('Рыба','150 г',240)}${row('Картофель','200 г',160)}${row('Овощи','200 г',120)}
          <div class="fn-meal"><span>Ужин</span><strong>520 ккал</strong></div>
          <button class="cs-pill fn-action" data-nutrition-step="1">Сохранить</button>
        </section>
        <section class="fn-state fn-result" aria-hidden="true" inert><div class="fn-subtitle fn-date">‹ <span>Сегодня</span> ›</div>
          <div class="fn-total"><span>Всего съедено</span><strong>1 840</strong><b>ккал за день</b></div>
          <div class="fn-day-row"><span class="fn-food-icon fn-breakfast"></span><span>Завтрак</span><b>420 ккал</b></div>
          <div class="fn-day-row"><span class="fn-food-icon fn-lunch"></span><span>Обед</span><b>650 ккал</b></div>
          <div class="fn-day-row"><span class="fn-food-icon fn-snack"></span><span>Перекус</span><b>250 ккал</b></div>
          <div class="fn-day-row fn-dinner"><div class="fn-food fn-thumb"></div><span>Ужин</span><b>520 ккал</b><i>✓</i></div>
          <div class="cs-pill fn-action">+ Добавить еду</div>
        </section>
        <nav class="fn-nav"><span><svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/></svg><small>Главная</small></span><span class="on"><svg viewBox="0 0 24 24"><path d="M5 2v7m3-7v7M2 2v7q3 5 6 0M5 12v10M17 2v20m0-20q-7 10 0 11"/></svg><small>Дневник</small></span><span><svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M3 22v-3a9 9 0 0 1 18 0v3Z"/></svg><small>Профиль</small></span></nav>
      </div><div class="cs-home"></div>
    </div>
    <ol class="cs-steps"><li><button data-nutrition-step="0"><span>01</span>Записываешь еду</button></li><li><button data-nutrition-step="1"><span>02</span>Видишь итог за день</button></li></ol>
    <aside class="speaker-notes">Утверждённый эскиз дневника питания. Демонстрационные данные, не персональные рекомендации: ужин 240 + 160 + 120 = 520 ккал; день 420 + 650 + 250 + 520 = 1840 ккал. Один переход от ввода к итогу; корпус телефона неподвижен.</aside>`;
  stories[index].slide.after(slide);
  slide.addEventListener('click',e=>{const b=e.target.closest('[data-nutrition-step]');if(b&&window.FIT_MOTION)FIT_MOTION.transitionTo([...document.querySelectorAll('#deck>.slide')].indexOf(slide),+b.dataset.nutritionStep);});
  stories.splice(index+1,0,{slide,stops:[0,1],labels:['Запись еды','Калории за день'],pause(){slide.getAnimations({subtree:true}).forEach(a=>a.cancel());},render(n,motion,animate){
    const previous=+(slide.dataset.csStep||0);slide.dataset.csStep=n;
    slide.querySelectorAll('.fn-state').forEach((el,i)=>{el.inert=i!==n;el.setAttribute('aria-hidden',String(i!==n));});
    slide.querySelectorAll('.cs-steps button').forEach((b,i)=>{if(i===n)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    slide.querySelector('.cs-lead').innerHTML=n?'Все приёмы пищи — в одном дневнике.<br>Видишь, сколько калорий съел за день.':'Добавляешь еду и порции.<br>ФИТ считает калории и сохраняет запись в дневнике.';
    if(motion&&previous!==n){animate(slide.querySelector(n?'.fn-result':'.fn-entry'),[{opacity:0,transform:'translateY(14px)'},{opacity:1,transform:'none'}],500);if(n)animate(slide.querySelector('.fn-dinner'),[{background:'#394528'},{background:'#20251b'}],800);}
  }});
})();
