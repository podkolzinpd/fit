/* Approved opening: fourteen reversible presenter stops; no market figures. */
window.FIT_PROBLEMS = (() => {
  const titles = [
    'Хочу заниматься. Не знаю, с чего начать','Как найти подходящего тренера?',
    'Сколько было килограммов и подходов?','План есть. Но сегодня всё иначе',
    'Тренируюсь. А что изменилось?','План, питание и результаты — в разных местах',
    'Пропустил тренировку. Потом ещё одну',
    'Тренировать умею. Клиентов нужно искать','Занятие длится час. Работа — не только в зале',
    'Что делали в прошлый раз? Ищу в переписке','Один перенёс, другой отменил. Собираю расписание заново',
    'Занятие провёл. Об оплате снова напоминаю','Программу отправил. Как прошла тренировка — не знаю',
    'Клиентов больше. На каждого — меньше времени'
  ];
  const short = ['Не знаю, с чего начать','Сложно найти тренера','Не помню веса и подходы','План не подходит','Не вижу результата','Всё разбросано','Теряю регулярность',
    'Сложно найти клиентов','Много времени на подготовку','История теряется в переписке','Постоянные переносы','Напоминаю об оплате','Не хватает обратной связи','Не успеваю ответить всем'];
  const sources=['athlete-1','athlete-2','trainer-1','trainer-2'];
  // Decode even hidden scenes before allowing an empty photo to enter the stage.
  const ready=Promise.all(sources.map(name=>{const img=new Image();img.src='assets/problems-'+name+'.png';return img.decode();}));
  let root, chapter, heading, rail, counter, cards;
  function mount(slide) {
    root=slide;
    // Previous source is retained in Git, not as an extra audience-facing slide.
    root.classList.add('problem-story');
    root.classList.add('ps-loading');
    ready.then(()=>root.classList.remove('ps-loading')).catch(()=>{root.classList.remove('ps-loading');root.classList.add('ps-load-error');});
    root.innerHTML='<div class="ps-eyebrow">01 · ПРОБЛЕМА</div><h2 class="ps-heading"></h2><div class="ps-chapter"></div><ol class="ps-rail"></ol><div class="ps-cards"></div><div class="ps-counter"></div>';
    heading=root.querySelector('h2');chapter=root.querySelector('.ps-chapter');
    rail=root.querySelector('ol');counter=root.querySelector('.ps-counter');
    cards=titles.map((title,i)=>{
      const local=i%7, group=i<7?'athlete':'trainer';
      const sheet=local<4?1:2;
      const box=local<4
        ? [1024,1536,local%2?536:32,local<2?(group==='athlete'?96:92):(group==='athlete'?797:806),457,local<2?(group==='athlete'?504:550):(group==='athlete'?532:522)]
        : [1774,887,30+(local-4)*584,98,545,group==='athlete'?581:534];
      const [w,h,x,y,cw,ch]=box;
      const card=document.createElement('article');card.className='ps-card';
      const photo=document.createElement('div');photo.className='ps-photo';
      const crop=document.createElement('div');crop.className='ps-crop';
      crop.style.width=Math.min(484,452*cw/ch)+'px';
      crop.style.aspectRatio=cw+'/'+ch;
      crop.style.backgroundImage='url(assets/problems-'+group+'-'+sheet+'.png)';
      crop.style.backgroundSize=(w/cw*100)+'% '+(h/ch*100)+'%';
      crop.style.backgroundPosition=(x/(w-cw)*100)+'% '+(y/(h-ch)*100)+'%';
      photo.append(crop);
      const caption=document.createElement('div');caption.className='ps-caption';
      caption.innerHTML='<span>0'+(local+1)+'</span><h3></h3>';
      caption.querySelector('h3').textContent=title;
      card.append(photo,caption);root.querySelector('.ps-cards').append(card);return card;
    });
    render(0,false);
  }
  function render(n,motion) {
    const group=n<7?0:1, local=n%7;
    root.classList.toggle('ps-animate',motion);
    heading.textContent=group?'Хочу тренировать. Что отнимает время?':'Хочу заниматься. Что мешает?';
    chapter.textContent=group?'ТРЕНЕР':'СПОРТСМЕН';
    counter.textContent=(group?'Тренер':'Спортсмен')+' · '+(local+1)+' из 7';
    rail.replaceChildren();
    for(let j=0;j<=local;j++){
      const li=document.createElement('li');li.className=j===local?'ps-current':'';
      li.innerHTML='<span>0'+(j+1)+'</span>';li.append(document.createTextNode(short[group*7+j]));rail.append(li);
    }
    cards.forEach((card,i)=>{
      const distance=n-i, visible=Math.floor(i/7)===group&&distance>=0&&distance<=2;
      card.setAttribute('aria-hidden',String(!visible));
      card.style.zIndex=String(20-distance);
      card.style.opacity=visible?'1':'0';
      card.style.filter=distance===0?'none':'brightness('+(distance===1?'.6':'.35')+')';
      card.querySelector('.ps-caption').style.visibility=visible&&distance===0?'visible':'hidden';
      card.style.transform=distance<0?'translateX(110px)':distance===0?'translateX(0) scale(1)':
        'translate('+(-distance*53)+'px,'+(distance*16)+'px) scale('+(1-distance*.025)+')';
      card.style.visibility=visible?'visible':'hidden';
    });
  }
  return {mount,render,titles,ready};
})();
