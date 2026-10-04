/* Review 6.3: mobile proportions and plain-language narration.
 * Replaces 6.2 per user request. Same example, same exercise assets. */
(() => {
  const source = window.FIT_CLIENT_AI?.slide;
  if (!source) return;
  const slide = source.cloneNode(true);
  slide.classList.add('ca-phone');
  slide.dataset.version = '6.3';
  slide.dataset.section = '05 · ДЛЯ КЛИЕНТА · ПРОГРАММА С ИИ';
  const q = selector => slide.querySelector(selector);
  const explanations = [
    'Рассказываешь, чего хочешь и когда можешь заниматься. ИИ составляет программу с учётом твоих целей и прошлых тренировок.',
    'Получаешь программу прямо в Fit — ничего не нужно переносить вручную. Проверяешь и добавляешь в расписание.',
    'Открываешь тренировку и начинаешь заниматься. Упражнения, подходы и повторы уже перед тобой.'
  ];
  q('.ca-lead').remove();
  q('.ca-explain').textContent = explanations[0];
  q('.ca-bubble').textContent = 'Хочу стать сильнее. Составь программу на 4 недели: пн, ср, пт, по 45 минут. Занимаюсь в зале.';
  q('.ca-answer p').textContent = 'Учту твою цель, расписание и прошлые тренировки.';
  q('.ca-context-row:nth-child(3) strong').textContent = 'Пн, ср, пт · 45 мин';
  q('.ca-app-title').textContent = 'Ассистент';
  q('.ca-program-heading .ca-ready').textContent = 'Проверь план';
  q('.ca-summary').innerHTML = '<span><b>4</b> недели</span><span><b>3</b> раза в неделю</span><span><b>45</b> мин</span>';
  q('.ca-exercise-row:nth-last-child(2) strong').textContent = 'Сведение рук';
  const status = document.createElement('div');status.className='ca-phone-status';status.setAttribute('aria-hidden','true');
  status.innerHTML = '<span>9:41</span><svg viewBox="0 0 46 16"><path d="M1 13h3V9H1zm5 0h3V6H6zm5 0h3V2h-3z" fill="currentColor" stroke="none"/><rect x="23" y="3" width="19" height="10" rx="2" fill="none" stroke="currentColor"/><path d="M44 6v4" stroke="currentColor"/><rect x="25" y="5" width="15" height="6" rx="1" fill="currentColor" stroke="none"/></svg>';
  q('.ca-app').prepend(status);
  q('.speaker-notes').textContent = 'Версия 6.3 заменяет широкий вариант 6.2 по просьбе пользователя. Вертикальный экран телефона; один абзац пояснения на состояние. Иллюстрация с демонстрационными данными, не запись реального запроса к ИИ и не рекомендация тренировочной нагрузки. Программа проверяется перед добавлением в расписание; доступность генерации регулируется пилотом. Fit Lime: текущие формы кнопок, карточек и сообщения ассистента. Оригинальные анимация и изображения упражнений Fit не изменены. Полное название упражнения «Сведение рук в тренажёре» сохранено в alt изображения. Композиционный ориентир linear/03: один крупный интерфейс и последовательность; чужая айдентика не переносилась.';
  source.replaceWith(slide);
  const video=q('video');
  window.FIT_CLIENT_AI_PHONE={
    slide,
    pause(){video.pause();},
    render(n,motion,animate,still=false){
      const previous=Number(slide.dataset.caStep||0);slide.dataset.caStep=n;
      q('.ca-explain').textContent=explanations[n];
      q('.ca-app-title').textContent=['Ассистент','Программа','Тренировка'][n];
      slide.querySelectorAll('[data-ca-screen]').forEach((screen,i)=>{
        screen.classList.toggle('is-visible',i===n);screen.setAttribute('aria-hidden',String(i!==n));screen.inert=i!==n;
        if(i===n&&motion&&previous!==n)animate(screen,[{opacity:0,transform:`translateY(${n>previous?18:-18}px)`},{opacity:1,transform:'none'}],480);
      });
      slide.querySelectorAll('.ca-route button').forEach((button,i)=>button.setAttribute('aria-current',i===n?'step':'false'));
      video.pause();video.hidden=still;q('.ca-exercise-hero').classList.toggle('ca-still',still);
      if(n===2&&!still&&!document.hidden)video.play().catch(()=>{});
    }
  };
  slide.addEventListener('click',event=>{
    const button=event.target.closest('[data-ca-step]');
    if(button&&window.FIT_MOTION)window.FIT_MOTION.seek([...document.querySelectorAll('#deck>.slide')].indexOf(slide),Number(button.dataset.caStep));
  });
})();
