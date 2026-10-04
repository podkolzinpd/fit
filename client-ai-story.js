/* Client 6.2: a presentation adaptation of Fit's current assistant/program UI.
 * All example data is fictional. No network/API calls and no app mutations. */
(() => {
  const old = document.querySelector('[data-section="05 · ДЛЯ КЛИЕНТА"]');
  if (!old) return;
  const slide = document.createElement('section');
  slide.className = 'slide client-ai-story';
  slide.dataset.section = '05 · ДЛЯ КЛИЕНТА · ПРОГРАММА С ИИ';
  slide.dataset.version = '6.2';
  slide.dataset.slideType = 'product-flow';
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
  slide.innerHTML = `
    <div class="eyebrow"><span class="design-number">05</span> · ДЛЯ КЛИЕНТА</div>
    <h2>Составляешь <br>программу с ИИ</h2>
    <div class="ca-copy">
      <p class="ca-lead">Твоя цель становится<br>планом тренировок</p>
      <p class="ca-explain">Рассказываешь, чего хочешь.<br>Fit учитывает твои условия<br>и историю занятий.</p>
    </div>
    <ol class="ca-route" aria-label="Сценарий программы с ИИ">
      <li><button data-ca-step="0"><span>01</span> Твоя цель</button></li>
      <li><button data-ca-step="1"><span>02</span> Готовая программа</button></li>
      <li><button data-ca-step="2"><span>03</span> Можно тренироваться</button></li>
    </ol>
    <div class="ca-app" role="group" aria-label="Иллюстрация интерфейса Fit с демонстрационными данными">
      <div class="ca-app-header"><span class="ca-back">‹</span><strong class="ca-app-title">Ассистент</strong><span class="ca-app-mark">ФИТ</span></div>
      <section class="ca-screen ca-request" data-ca-screen="0">
        <div class="ca-bubble">Хочу стать сильнее. Составь программу<br>на 4 недели: пн, ср, пт, по 45 минут.<br>Занимаюсь в зале.</div>
        <div class="ca-answer"><span class="ca-ai">✦</span><p>Учту твой ритм и результаты<br>предыдущих тренировок.</p></div>
        <div class="ca-context"><div class="ca-context-heading">Данные и условия <span>⌃</span></div>
          <div class="ca-context-row"><span>Цель</span><strong>Стать сильнее</strong></div>
          <div class="ca-context-row"><span>Расписание</span><strong>3 раза в неделю · 45 мин</strong></div>
          <div class="ca-context-row"><span>Оборудование</span><strong>Тренажёрный зал</strong></div>
          <div class="ca-history"><span>ИСТОРИЯ В FIT</span><strong>Жим ногами <b>60 кг × 10</b></strong><small>Последний записанный результат</small></div>
        </div>
        <button class="ca-primary" data-ca-step="1">Подтвердить и составить ${arrow}</button>
      </section>
      <section class="ca-screen ca-program" data-ca-screen="1" aria-hidden="true" inert>
        <div class="ca-program-heading"><div><span class="ca-overline">ПРОГРАММА С ИИ</span><h3>Стать сильнее</h3></div><span class="ca-ready">Готово к проверке</span></div>
        <div class="ca-summary"><span><b>4</b> недели</span><span><b>3</b> занятия в неделю</span><span><b>45</b> минут</span></div>
        <div class="ca-weeks"><span class="selected">Неделя 1</span><span>Неделя 2</span><span>Неделя 3</span><span>Неделя 4</span></div>
        <div class="ca-days">
          <button class="ca-day" data-ca-step="2"><span class="ca-date">ПН<small>День А</small></span><span><strong>Всё тело</strong><small>Жим ногами · тяга · грудь</small></span><span class="ca-day-tail">45 мин ${arrow}</span></button>
          <div class="ca-day"><span class="ca-date">СР<small>День Б</small></span><span><strong>Всё тело</strong><small>Спина · ноги · плечи</small></span><span class="ca-day-tail">45 мин</span></div>
          <div class="ca-day"><span class="ca-date">ПТ<small>День В</small></span><span><strong>Всё тело</strong><small>Ноги · грудь · корпус</small></span><span class="ca-day-tail">45 мин</span></div>
        </div>
        <div class="ca-program-hint">Между занятиями — день отдыха.<br>Проверь программу перед добавлением.</div>
        <button class="ca-primary" data-ca-step="2">Добавить в расписание ${arrow}</button>
      </section>
      <section class="ca-screen ca-workout" data-ca-screen="2" aria-hidden="true" inert>
        <div class="ca-workout-heading"><div><span class="ca-overline">ПОНЕДЕЛЬНИК · ДЕНЬ А</span><h3>Всё тело</h3></div><span class="ca-ready">В расписании</span></div>
        <div class="ca-exercise-hero">
          <div class="ca-exercise-info"><span class="ca-overline">01 / 03</span><h4>Жим ногами</h4><p>3 подхода × 10 повторений</p><div class="ca-last">Последний результат<br><strong>60 кг × 10</strong></div></div>
          <video muted loop playsinline preload="metadata" poster="assets/client-ai/leg-press-machine.jpg" aria-label="Жим ногами: оригинальная анимация упражнения из каталога Fit"><source src="assets/client-ai/leg-press-machine.mp4" type="video/mp4"></video>
        </div>
        <div class="ca-exercise-row"><img src="assets/client-ai/romanian-deadlift.jpg" alt="Румынская тяга из каталога Fit"><div><strong>Румынская тяга</strong><span>3 подхода × 10 повторений</span></div><span class="ca-ex-num">02</span></div>
        <div class="ca-exercise-row"><img src="assets/client-ai/pec-deck.jpg" alt="Сведение рук в тренажёре из каталога Fit"><div><strong>Сведение рук в тренажёре</strong><span>3 подхода × 12 повторений</span></div><span class="ca-ex-num">03</span></div>
        <div class="ca-start" aria-label="Кнопка начала тренировки в иллюстрации">Начать тренировку ${arrow}</div>
      </section>
    </div>
    <aside class="speaker-notes">Версия 6.2 для согласования первого клиентского сценария. Предыдущая версия 6.1 сохранена непосредственно перед ней. Иллюстрация на демонстрационных данных, не запись реального запроса к ИИ и не рекомендация тренировочной нагрузки. Интерфейс адаптирован для презентации из текущего Fit Lime: assistant-message-user, assistant-context-panel, AssistantProgramOverview, карточки и primary-действия. История и условия подтверждаются перед генерацией; программа проверяется перед добавлением в расписание. Доступность генерации регулируется пилотом. Анимация и изображения упражнений взяты без изменения геометрии из каталога Fit. Композиционный ориентир linear/03: один доминирующий интерфейс и читаемая последовательность; чужая айдентика не переносилась.</aside>`;
  old.after(slide);
  const leads = [
    ['Твоя цель становится<br>планом тренировок', 'Рассказываешь, чего хочешь.<br>Fit учитывает твои условия<br>и историю занятий.'],
    ['Не ответ в чате<br>А готовая программа', 'Дни, упражнения и подходы<br>уже собраны в приложении.<br>Остаётся проверить и добавить.'],
    ['Открываешь день<br>И начинаешь занятие', 'Техника, подходы и повторы —<br>рядом. Программа остаётся<br>здесь же, в Fit.']
  ];
  const video = slide.querySelector('video');
  window.FIT_CLIENT_AI = {
    slide,
    pause(){ video.pause(); },
    render(n, motion, animate, still=false){
      const previous = Number(slide.dataset.caStep || 0);
      slide.dataset.caStep = n;
      slide.querySelector('.ca-lead').innerHTML = leads[n][0];
      slide.querySelector('.ca-explain').innerHTML = leads[n][1];
      slide.querySelector('.ca-app-title').textContent = ['Ассистент','Программа тренировок','Тренировка'][n];
      slide.querySelectorAll('[data-ca-screen]').forEach((screen,i)=>{
        screen.classList.toggle('is-visible',i===n);
        screen.setAttribute('aria-hidden',String(i!==n));screen.inert=i!==n;
        if(i===n && motion && n!==previous)animate(screen,[{opacity:0,transform:`translateY(${n>previous?22:-22}px)`},{opacity:1,transform:'translateY(0)'}],540);
      });
      slide.querySelectorAll('.ca-route button').forEach((button,i)=>button.setAttribute('aria-current',i===n?'step':'false'));
      video.pause();
      video.hidden=still;
      const hero=slide.querySelector('.ca-exercise-hero');
      hero.classList.toggle('ca-still',still);
      if(n===2&&!still&&!document.hidden)video.play().catch(()=>{});
    }
  };
  slide.addEventListener('click',event=>{
    const button=event.target.closest('[data-ca-step]');
    if(button&&window.FIT_MOTION)window.FIT_MOTION.seek([...document.querySelectorAll('#deck>.slide')].indexOf(slide),Number(button.dataset.caStep));
  });
})();
