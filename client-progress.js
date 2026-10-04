/* Replacement, not an extra overview. Evidence: existing progress-map.png.
 * 46 → 48 kg is maximum recorded weight, NOT training volume or muscle growth. */
(() => {
  const old=document.querySelector('#deck>[data-section="05 · ДЛЯ КЛИЕНТА"]');
  const stories=window.FIT_CLIENT_STORIES;
  if(!old||!stories?.length)return;
  const reserve=document.createElement('template');reserve.id='client-overview-reserve';
  old.after(reserve);reserve.content.append(old);
  const slide=document.createElement('section');
  slide.className='slide client-ai-story client-story cs-progress';
  Object.assign(slide.dataset,{section:'05 · ДЛЯ КЛИЕНТА · ПРОГРЕСС',version:'6.7',slideType:'metric-hero',golden:'whoop/11-whoop-progress-trend.png'});
  slide.innerHTML=`
    <div class="eyebrow"><span class="design-number">05</span> · ДЛЯ КЛИЕНТА</div>
    <h2>Видишь свой прогресс</h2>
    <div class="cp-result"><span class="cp-label">МАКСИМАЛЬНЫЙ ВЕС</span>
      <div class="cp-values"><div><small>Было</small><strong>46</strong></div><span>→</span><div><small>Стало</small><strong>48<em> кг</em></strong></div></div>
      <h3>Присед со штангой</h3>
      <div class="cp-achievement"><strong>+2 кг</strong><p>К максимальному весу<br>в этом упражнении</p></div>
    </div>
    <div class="cs-phone cp-detail" aria-hidden="true" inert>
      <div class="cs-status"><span>9:41</span><span>ФИТ</span></div>
      <header class="cs-app-head"><span>‹</span><strong>Мой прогресс</strong><i>ФИТ</i></header>
      <div class="cs-phone-body">
        <div class="cp-exercise"><span class="cs-app-label">Упражнение</span><h3>Присед со штангой</h3><p>Максимальный вес <b>46 → 48 кг</b></p></div>
        <div class="cp-link" aria-hidden="true"></div>
        <div class="cp-body"><span class="cs-app-label">Карта тела · прогресс</span>
          <div class="cp-map-crop"><img src="assets/trainer-lime/progress-map.png" alt="Исходная карта Fit: выделена передняя поверхность бедра"></div>
          <h4>Передняя поверхность бедра</h4>
        </div>
      </div><div class="cs-home" aria-hidden="true"></div>
    </div>
    <ol class="cs-steps" aria-label="Шаги сценария"><li><button data-cp-step="0"><span>01</span>Было → стало</button></li><li><button data-cp-step="1"><span>02</span>Упражнение и карта тела</button></li></ol>
    <aside class="speaker-notes">Источник всех чисел и связи с мышечной группой: существующий экран assets/trainer-lime/progress-map.png. Присед со штангой, максимальный вес 46 → 48 кг; +2 кг — арифметическая разница этих значений, не новая награда приложения и не рост силы в процентах. Не связано с предыдущей демонстрацией жима ногами. Карта тела объясняет упражнение, не изображает рост мышц. Композиция whoop/11: результат доминирует, объяснение вторично; чужие стиль и метрики не переносились. Один клик раскрывает упражнение и затем карту, без промежуточной остановки. Старый обзор сохранён только в template#client-overview-reserve.</aside>`;
  stories[0].slide.after(slide);
  const story={slide,stops:[0,1],labels:['Было → стало','Упражнение и карта тела'],pause(){},render(n,motion,animate){
    const previous=+(slide.dataset.csStep||0);slide.dataset.csStep=n;
    const detail=slide.querySelector('.cp-detail');detail.setAttribute('aria-hidden',String(!n));detail.inert=!n;
    if(n&&motion&&previous!==n){
      animate(detail,[{opacity:0},{opacity:1}],350);
      animate(slide.querySelector('.cp-body'),[{opacity:0},{opacity:0,offset:.45},{opacity:1}],950);
      animate(slide.querySelector('.cp-link'),[{transform:'scaleY(0)'},{transform:'scaleY(0)',offset:.3},{transform:'scaleY(1)'}],700);
    }
    slide.querySelectorAll('[data-cp-step]').forEach((b,i)=>b.setAttribute('aria-current',i===n?'step':'false'));
  }};
  stories.splice(1,0,story);
  slide.addEventListener('click',e=>{const b=e.target.closest('[data-cp-step]');if(b&&window.FIT_MOTION)FIT_MOTION.transitionTo([...document.querySelectorAll('#deck>.slide')].indexOf(slide),+b.dataset.cpStep);});
})();
