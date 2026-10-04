/* Approved financial sequence, motion-v2 only. All values in RUB millions,
 * except turnover (RUB billions). Workbook: Fit_рынок_РФ [yHAbhX].xlsx.
 * Turnover = Revenue model rows 49 + 53 + 61 + 62, plus gross advertising
 * and partner purchase value (average MAU × rollout × the Assumptions drivers).
 * Commissions are NOT added a second time. Off-platform training is excluded.
 */
(() => {
  'use strict';
  const data = [
    {year:2027,revenue:[1.17800571792054,2.1952931962966,2.60223979817592,0],costs:[96.21276915,18.286647913838,3.83893101196],turnover:.0883895955318296,ebitda:-112.362809363405},
    {year:2028,revenue:[20.9255899423869,19.2960601101066,35.2881474346433,0],costs:[131.466759,52.318088462847,45.2339764110842],turnover:1.08260312507102,ebitda:-153.509026386794},
    {year:2029,revenue:[87.5765769830313,52.6219457099859,137.049331675705,17.3032632233063],costs:[166.8970712,72.0680987484471,147.022653034024],turnover:3.95257022815835,ebitda:-91.4367053904431},
    {year:2030,revenue:[227.252029290225,101.358394879061,353.664602958373,55.160981658174],costs:[191.741578712,101.899976341668,322.394478865588],turnover:9.40541284678614,ebitda:121.399974866577},
    {year:2031,revenue:[466.247397020805,167.240614189964,749.814155140008,127.327516163642],costs:[208.93769887416,145.461183215507,588.284274191545],turnover:18.4479623779881,ebitda:567.946526233206}
  ];
  const modes=['revenue','costs','result'];
  const selectors=['10 · ВЫРУЧКА','11 · РАСХОДЫ','12 · ФИНАНСОВЫЙ РЕЗУЛЬТАТ'];
  const slides=selectors.map(s=>document.querySelector(`#deck>[data-section="${s}"]`));
  if(slides.some(s=>!s))throw new Error('Financial story: expected three source slides');
  // The approved old charts remain accessible without adding presenter stops.
  if(new URLSearchParams(location.search).has('finance-reserve'))return;
  const sum=xs=>xs.reduce((a,b)=>a+b,0);
  const integer=n=>Math.round(n).toLocaleString('ru-RU');
  const decimal=(n,d=2)=>n.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});
  const signed=n=>(n<0?'−':'+')+integer(Math.abs(n));
  const money=n=>n<1?`${integer(n*1000)} млн ₽`:`${decimal(n)} млрд ₽`;
  const centers=[185,455,725,995,1265], baseline=290, unit=270/1600;
  const revenueColors=['#d6f500','#91a600','#f5f4ef','#596267'];
  const costColors=['#697277','#969e9f','#c5cbca'];
  function stack(values,x,width,colors,cls){
    let accumulated=0;
    return `<g class="${cls}">`+values.map((value,i)=>{
      const height=value*unit;accumulated+=height;
      return `<rect x="${x-width/2}" y="${baseline-accumulated}" width="${width}" height="${height}" fill="${colors[i]}" data-value="${value}"/>`;
    }).join('')+'</g>';
  }
  function chart(mode){
    const grid=[0,500,1000,1500].map(v=>`<line x1="75" x2="1390" y1="${baseline-v*unit}" y2="${baseline-v*unit}"/><text x="55" y="${baseline-v*unit+6}" text-anchor="end">${integer(v)}</text>`).join('');
    const columns=data.map((d,i)=>{
      const x=centers[i],revenue=sum(d.revenue),cost=sum(d.costs),revY=baseline-revenue*unit,costY=baseline-cost*unit;
      const top=Math.min(revY,costY),gap=Math.abs(d.ebitda)*unit;
      const costInset=mode==='costs'&&d.ebitda>0;
      const labelY=costInset?costY+28:(mode==='revenue'?revY:mode==='costs'?costY:top)-13;
      const totalLabel=mode==='revenue'?integer(revenue):mode==='costs'?integer(cost):signed(d.ebitda);
      return `<g class="ff-year" data-year="${d.year}">
        <rect class="ff-revenue-outline" x="${x-76}" y="${revY}" width="152" height="${revenue*unit}"/>
        ${stack(d.revenue,x,152,revenueColors,'ff-revenue-fill')}
        ${stack(d.costs,x,86,costColors,'ff-cost-fill')}
        <g class="ff-gap ${d.ebitda>0?'ff-positive':'ff-negative'}"><rect x="${x-39}" y="${top}" width="78" height="${gap}"/>
          <path d="M${x+82} ${top} h10 v${gap} h-10"/></g>
        <text class="ff-value ${i===4?'ff-last':''} ${costInset?'ff-cost-inset':''} ${mode==='result'&&d.ebitda>0?'ff-positive-value':''}" x="${x}" y="${labelY}" text-anchor="middle">${totalLabel}</text>
        <text class="ff-year-name" x="${x}" y="329" text-anchor="middle">${d.year}</text>
      </g>`;
    }).join('');
    return `<svg class="ff-chart" viewBox="0 0 1448 355" role="img" aria-label="${mode==='revenue'?'Выручка':mode==='costs'?'Расходы на фоне выручки':'EBITDA как разница выручки и расходов'} за 2027–2031 годы, млн рублей. Одинаковая шкала на всех трёх слайдах."><g class="ff-grid">${grid}</g>${columns}</svg>`;
  }
  const legends={
    revenue:'<span><i style="background:#d6f500"></i>Подписки клиентов</span><span><i style="background:#91a600"></i>Подписки тренеров</span><span><i style="background:#f5f4ef"></i>Комиссии</span><span><i style="background:#596267"></i>Реклама и партнёрские продажи</span>',
    costs:'<span><i class="ff-outline-key"></i>Выручка</span><span><i style="background:#697277"></i>Команда и инструменты</span><span><i style="background:#969e9f"></i>Маркетинг</span><span><i style="background:#c5cbca"></i>Работа сервиса</span>',
    result:'<span><i class="ff-outline-key"></i>Выручка</span><span><i style="background:#969e9f"></i>Расходы</span><span><i style="background:#d6f500"></i>Положительная EBITDA</span><span><i style="background:#596267"></i>Отрицательная EBITDA</span>'
  };
  const heroes={
    revenue:`<div class="ff-hero-main"><span class="ff-kicker">ОБОРОТ, С КОТОРОГО FIT ПОЛУЧАЕТ ДОХОД</span><strong>18,45 <small>млрд ₽</small></strong></div><span class="ff-hero-arrow">→</span><div class="ff-hero-secondary"><span class="ff-kicker">ВЫРУЧКА FIT</span><strong>1,51 <small>млрд ₽</small></strong></div>`,
    costs:`<div class="ff-hero-main"><span class="ff-kicker">РАСХОДЫ ДО EBITDA</span><strong>943 <small>млн ₽</small></strong></div><div class="ff-hero-secondary ff-cost-context"><span class="ff-kicker">ПРИ ВЫРУЧКЕ</span><strong>1,51 <small>млрд ₽</small></strong></div>`,
    result:`<div class="ff-hero-main"><span class="ff-kicker">EBITDA</span><strong>568 <small>млн ₽</small></strong></div><div class="ff-hero-secondary ff-margin"><span class="ff-kicker">МАРЖА EBITDA</span><strong>37,6<small>%</small></strong></div><div class="ff-equation">1 511 − 943 = 568 <small>млн ₽</small><span>Выручка − расходы = EBITDA</span></div>`
  };
  const bottoms={
    revenue:`<div class="ff-turnover-label">Совокупный оборот</div><div class="ff-turnover-values">${data.map(d=>`<strong>${money(d.turnover)}</strong>`).join('')}</div><p class="ff-turnover-definition">Оплаты тренировок и сопровождения, подписки, партнёрские покупки и реклама</p>`,
    costs:`<div class="ff-cost-breakdown"><div><strong>588 <small>млн ₽</small></strong><b>Работа сервиса</b><p>ИИ, облако, поддержка и эквайринг</p></div><div><strong>209 <small>млн ₽</small></strong><b>Команда и инструменты</b><p>Зарплаты с начислениями и ИИ-инструменты</p></div><div><strong>146 <small>млн ₽</small></strong><b>Маркетинг</b><p>Бонусы, партнёрства, события и реклама</p></div></div>`,
    result:`<div class="ff-milestones"><div><strong>Февраль 2030</strong><span>Первый месяц с положительной EBITDA</span></div><div><strong>Июль 2031</strong><span>Окупаемость по накопленному денежному потоку</span></div></div>`
  };
  const descriptions={
    revenue:'Выручка по источникам · млн ₽ за год',
    costs:'Расходы поверх выручки · млн ₽ за год',
    result:'Разница между выручкой и расходами · млн ₽ за год'
  };
  const commonNotes='Источник: Fit_рынок_РФ [yHAbhX].xlsx, Revenue model BJ:BN, P&L BJ:BN, Assumptions B80:B92. Значения за календарный год, не декабрьский run-rate. Прогноз со сценарием Яндекс Плюса. Вспомогательные расходы ещё не полностью оценены. Композиционный ориентир whoop/11: единая шкала времени и крупный результат; сохраняются только текущие цвета и шрифты Fit. Графики выручки, расходов и EBITDA используют одну линейную шкалу 0–1600 млн ₽ и одну базовую линию. GMV не нанесён на эту шкалу. Кнопки назад/вперёд меняют слайд за один клик, без новых остановок.';
  slides.forEach((slide,index)=>{
    const mode=modes[index];
    const oldNotes=slide.dataset.notes||'';
    const reserve=document.createElement('template');reserve.id=`finance-reserve-${mode}`;
    reserve.content.append(slide.cloneNode(true));document.body.append(reserve);
    const eyebrow=slide.querySelector('.eyebrow').outerHTML;
    slide.classList.add('ff-slide');slide.dataset.financeMode=mode;
    slide.dataset.golden='whoop/11-whoop-progress-trend.png';slide.dataset.slideType='progress-trend';
    const [family,revision]=slide.dataset.version.split('.');slide.dataset.version=`${family}.${Number(revision)+1}`;
    const extra=mode==='revenue'?'Совокупный оборот 2031: 15 784 376 366,88 ₽ оплат тренировок + 888 427 068,47 ₽ онлайн-сопровождения + 633 488 011,21 ₽ подписок и вступительных взносов + 1 033 186 363,28 ₽ партнёрских покупок + 108 484 568,14 ₽ рекламных оплат = 18 447 962 377,99 ₽. Подписки включают клиентов и тренеров. Покупки у партнёров учтены только в объёме, на котором Fit получает комиссию. Отдельного распределения по Маркету, Лавке и Еде в файле нет. Комиссии повторно не добавляются, оплаты тренировок вне Fit исключены. Реклама и товары монетизируются с 2029 года.':mode==='costs'?'Работа сервиса — P&L 19. Команда и инструменты — P&L 35 + 47. Маркетинг — P&L 41. 209 млн ₽ включает 201,6 млн ₽ персонала с начислениями и 7,3 млн ₽ корпоративных ИИ-инструментов. Отдельные внешние юридические, бухгалтерские и административные затраты ещё не оценены.':'EBITDA = P&L 11 − 19 − 35 − 41 − 47. Первый положительный месяц — февраль 2030. Первый положительный год — 2030. Пик потребности в финансировании 361,78 млн ₽ в январе 2030. Накопленный FCF выходит в плюс в июле 2031. Денежный поток и EBITDA не тождественны. Старый график FCF и траншей сохранён в резерве, доступен через ?finance-reserve=all#17.';
    slide.dataset.notes=commonNotes+' '+extra;
    slide.innerHTML=`${eyebrow}<h2>${['Выручка и GMV','Расходы','Финансовый результат'][index]}</h2>
      <div class="ff-period">2031 год · прогноз</div>
      <div class="ff-hero">${heroes[mode]}</div>
      <div class="ff-chart-caption">${descriptions[mode]}</div>
      <div class="ff-legend">${legends[mode]}</div>
      ${chart(mode)}
      <div class="ff-bottom ff-bottom-${mode}">${bottoms[mode]}</div>
      <div class="ff-model-note">Сценарий с Яндекс Плюсом${mode==='revenue'?'':' · по оценённым статьям расходов'}</div>
      <aside class="speaker-notes">${commonNotes} ${extra}\n\nРезерв исходного слайда: ${oldNotes}</aside>`;
  });
  let previousSlide=null;
  function render(slide,motion,animate){
    const oldMode=previousSlide?.dataset.financeMode,mode=slide?.dataset.financeMode;
    const changed=previousSlide!==slide;previousSlide=slide;
    if(!mode||!motion||!changed)return;
    const q=s=>slide.querySelector(s),qa=s=>[...slide.querySelectorAll(s)];
    const oldRevenue=oldMode==='revenue'?1:0,newRevenue=mode==='revenue'?1:0;
    const oldCost=oldMode&&oldMode!=='revenue'?1:0,newCost=mode==='revenue'?0:1;
    const oldGap=oldMode==='result'?1:0,newGap=mode==='result'?1:0;
    // New scene starts at the old chart's appearance: no whole-chart crossfade.
    qa('.ff-revenue-fill').forEach(el=>animate(el,[{opacity:oldMode?oldRevenue:0},{opacity:newRevenue}],650));
    qa('.ff-revenue-outline').forEach(el=>animate(el,[{opacity:oldMode&&oldMode!=='revenue'?1:0},{opacity:mode==='revenue'?0:1}],650));
    qa('.ff-cost-fill').forEach(el=>{
      if(newCost&&!oldCost)animate(el,[{transform:'scaleY(0)',opacity:0},{transform:'scaleY(1)',opacity:1}],700);
      else animate(el,[{opacity:oldCost},{opacity:newCost}],600);
    });
    qa('.ff-gap').forEach(el=>animate(el,[{opacity:oldGap},{opacity:oldGap,offset:.2},{opacity:newGap}],750));
    qa('.ff-value').forEach(el=>animate(el,[{opacity:0},{opacity:0,offset:.4},{opacity:1}],750));
    animate(q('.ff-bottom'),[{opacity:0},{opacity:0,offset:.35},{opacity:1}],750);
    if(mode==='revenue'){
      animate(q('.ff-hero-secondary'),[{opacity:0,transform:'translateX(-12px)'},{opacity:0,offset:.2},{opacity:1,transform:'none'}],700);
      animate(q('.ff-hero-arrow'),[{opacity:0},{opacity:1}],500);
    }
  }
  window.FIT_FINANCE={data,slides,render,scale:{baseline,unit,max:1600,centers},version:1};
})();
