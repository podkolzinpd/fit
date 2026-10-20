/* Demo history requested by the owner. Actual app artwork and award criteria.
 * Compositional references: whoop/11 (trend), whoop/10 (one metric/award hero).
 * No production data, application code, or financial assumptions are changed. */
(() => {
  const old=document.querySelector('#deck>[data-section="05 · ДЛЯ КЛИЕНТА"]');
  const stories=window.FIT_CLIENT_STORIES;
  if(!old||!stories?.length)return;
  const reserve=document.createElement('template');reserve.id='client-overview-reserve';
  old.after(reserve);reserve.content.append(old);
  // Ten completed workouts across five calendar weeks; two plateaus and a deload.
  const history=[['05.09',10],['08.09',10],['11.09',11],['14.09',11],['18.09',11],['21.09',11],['24.09',11],['27.09',10],['30.09',11],['04.10',12]];
  const chartY=weight=>117-(weight-10)*42;
  const points=history.map(([date,weight],i)=>({date,weight,x:36+i*35,y:chartY(weight)}));
  const line=points.map(p=>`${p.x},${p.y}`).join(' ');
  const badge=(id,cls='')=>`<span class="pm-badge ${cls}"><img src="assets/progress-month/${id}.webp" alt=""></span>`;
  const phone=(title,body)=>`<div class="cs-phone pm-phone"><div class="cs-status"><span>9:41</span><span>▂▃▅ ▰</span></div><header class="cs-app-head"><span>‹</span><strong>${title}</strong><i>ФИТ</i></header><div class="cs-phone-body">${body}</div><div class="cs-home" aria-hidden="true"></div></div>`;
  const notes='Демонстрационный профиль, не реальные результаты пользователей Fit. 10 завершённых тренировок: '+history.map(([d,v])=>d+' — '+v+' кг').join('; ')+'. Максимальный записанный вес одной гантели в подъёме на бицепс, не тоннаж и не оценка роста силы. Последняя тренировка: подъём гантелей на бицепс, 3×10, по 12 кг. CJ — декоративная пасхалка, не карта мышц. Награды и оригинальные иллюстрации взяты из приложения: src/shared/athlete-achievements.ts и src/assets/achievements. «Десятка тренировок»: завершить 10 тренировок; «Четыре недели»: завершить тренировку 4 недели подряд; «Первый рекорд»: первый личный рекорд в завершённой тренировке. Все три условия выполнены этой демонстрационной историей.';
  function scene(section,heading,body,golden){
    const s=document.createElement('section');s.className='slide client-ai-story client-story progress-month '+section;
    Object.assign(s.dataset,{section:'05 · ДЛЯ КЛИЕНТА · '+(section==='pm-trend'?'ПРОГРЕСС':'ДОСТИЖЕНИЯ'),version:'7.0',slideType:'metric-hero',golden});
    s.innerHTML=`<div class="eyebrow"><span class="design-number">05</span> · ДЛЯ КЛИЕНТА</div><h2>${heading}</h2>${body}<aside class="speaker-notes">${notes}</aside>`;
    return s;
  }
  const trend=scene('pm-trend','Видишь, как растут<br>результаты',`
    <div class="pm-copy"><p>Сравниваешь свои результаты за месяц<br>и видишь нагрузку по группам мышц</p>
      <div class="pm-main-result"><span>Подъём гантелей на бицепс</span><div><b>10</b><em>→</em><b class="pm-lime">12<small> кг</small></b></div><span>Вес одной гантели</span></div>
      <div class="pm-summary"><strong>+2 кг</strong><span>за месяц · 10 тренировок</span></div>
    </div>
    ${phone('Мой прогресс',`<div class="pm-period"><span>5 сентября — 4 октября</span><small>Пример за месяц</small></div>
      <div class="pm-card pm-trend-card"><span class="cs-app-label">Подъём гантелей на бицепс</span><div class="pm-phone-result"><strong>12 <small>кг</small></strong><span>+2 кг за месяц</span></div>
        <svg class="pm-chart" viewBox="0 0 384 185" role="img" aria-label="Вес одной гантели: 10, 10, 11, 11, 11, 11, 11, 10, 11, 12 кг">
          ${[10,11,12].map(w=>`<line x1="32" x2="354" y1="${chartY(w)}" y2="${chartY(w)}" stroke="#303034"/><text x="3" y="${chartY(w)+5}" fill="#93939c" font-size="13">${w}</text>`).join('')}
          <polyline class="pm-chart-line" points="${line}" fill="none" stroke="#b6ef4d" stroke-width="3" stroke-linejoin="round" pathLength="1"/>
          ${points.map((p,i)=>`<circle class="${i===9?'pm-last-point':''}" cx="${p.x}" cy="${p.y}" r="${i===9?6:3.5}" fill="#b6ef4d"/>`).join('')}
          <text x="32" y="178" fill="#93939c" font-size="13">5 сен</text><text x="183" y="178" fill="#93939c" font-size="13">21 сен</text><text x="316" y="178" fill="#93939c" font-size="13">4 окт</text>
        </svg><div class="pm-last"><span>Последняя тренировка</span><b>3 × 10 · по 12 кг</b></div>
      </div>
      <div class="pm-card pm-load"><div class="pm-load-title"><strong>Нагрузка</strong><span>4 октября</span></div>
        <div class="pm-map-row"><svg class="pm-body-map" viewBox="100 0 824 1536" role="img" aria-label="Си-Джей из GTA San Andreas — пасхалка">
          <image href="assets/progress-month/cj-low-poly.png" width="1024" height="1536"/></svg>
          <div><span class="pm-dot"></span><h4>Бицепс</h4><p>Подъём гантелей</p><strong>3 подхода</strong></div>
        </div>
      </div>`)}
  `,'whoop/11-whoop-progress-trend.png');
  const awards=scene('pm-awards','Отмечаешь свои<br>достижения',`
    <div class="pm-copy"><p>За регулярность, новые результаты<br>и завершённые тренировки</p><div class="pm-award-copy"><span class="pm-lime">Десятка тренировок</span><strong>10 тренировок<br>позади</strong><p>Каждая запись — часть твоей истории</p></div></div>
    ${phone('Достижения',`<div class="pm-award-hero">${badge('workouts-10','pm-hero-badge')}<span class="pm-earned">✓ Получено 4 октября</span><h3>Десятка тренировок</h3><p>Завершить 10 тренировок</p><div class="pm-award-bar"><i></i></div><span class="pm-award-count">10 из 10</span></div>
      <div class="pm-other-title">Ещё в твоей коллекции</div><div class="pm-other-awards"><div>${badge('weeks-4')}<strong>Четыре недели</strong><small>Тренироваться<br>4 недели подряд</small></div><div>${badge('records-1')}<strong>Первый рекорд</strong><small>Первый личный рекорд<br>в тренировке</small></div></div>`)}
  `,'whoop/10-whoop-metric-hero.png');
  stories[0].slide.after(trend,awards);
  const makeStory=(slide,label)=>({slide,stops:[0],labels:[label],pause(){},render(n,motion,animate,still){
    slide.dataset.csStep='0';
    if(!motion||still)return;
    if(slide===trend){
      animate(slide.querySelector('.pm-chart-line'),[{strokeDasharray:'1',strokeDashoffset:1},{strokeDasharray:'1',strokeDashoffset:0}],600);
      animate(slide.querySelector('.pm-last'),[{opacity:0},{opacity:0,offset:.55},{opacity:1}],950);
      animate(slide.querySelector('.pm-load'),[{opacity:0},{opacity:0,offset:.72},{opacity:1}],1300);
    }else animate(slide.querySelector('.pm-hero-badge'),[{transform:'scale(.94)',opacity:.4},{transform:'scale(1)',opacity:1}],500);
  }});
  stories.splice(1,0,makeStory(trend,'Результаты за месяц'),makeStory(awards,'Достижения'));
  window.FIT_PROGRESS_DEMO={history,workouts:10,from:10,to:12,awards:['workouts-10','weeks-4','records-1']};
})();
