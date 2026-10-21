/* Approved editorial revision: one screen per argument, matching left columns. */
window.FIT_CHANNELS = {
  build(acquisition, value) {
    const rows = entries => `<div class="ce-list">${entries.map(([title,copy])=>`<div><h3>${title}</h3><p>${copy}</p></div>`).join('')}</div>`;
    const header = (section,title) => `<div class="eyebrow">${section}</div><h2>${title}</h2>`;
    [acquisition,value].forEach(s=>{
      s.dataset.notes += ' Полное содержание до сокращения: '+s.querySelector('.content').innerText;
      s.classList.add('ce-slide');
    });
    acquisition.innerHTML=header('07 · ПРИВЛЕЧЕНИЕ','Как привлекаем клиентов')+rows([
      ['Тренеры и спортсмены','Клубы и взаимные приглашения'],
      ['Яндекс Плюс','Предлагаем вступление в клуб за 0 ₽'],
      ['Экосистема Яндекса','Размещения в Go и сервисах — в планах'],
      ['Обучение тренеров','Курсы, спортвузы, Практикум — в планах'],
      ['Спортивные события','Тренировки, челленджи, мероприятия']
    ])+`<div class="ce-visual ce-club"><img src="assets/editorial/club-dumbbell.png" alt="Клубная карта FIT, Плюс и гантель"><div class="ce-offer"><strong>0 ₽</strong><h3>Вступление с Плюсом</h3><p>Предложение · условия согласуем</p></div></div>`;
    value.innerHTML=header('08 · ЦЕННОСТЬ ДЛЯ ЯНДЕКСА','Что FIT даёт Яндексу')+rows([
      ['Мессенджер · Телемост','Общение и видеотренировки'],
      ['Pay · Сплит','Оплата занятий и пакетов'],
      ['Бенефит для компаний','Спорт для сотрудников и команд'],
      ['Директ','Продвижение услуг тренеров'],
      ['Лавка · Еда · Маркет','Заказы питания и инвентаря']
    ])+`<div class="ce-visual ce-scenarios"><figure><img src="assets/editorial/video-barefoot-v2.png" alt="Спортсменка тренируется дома босиком, тренер наблюдает из зала"><figcaption>Видеотренировка</figcaption></figure><div class="ce-order"><h3>От рекомендаций — к заказу</h3><div class="ce-services"><div><img src="assets/editorial/lavka.png" alt="Яндекс Лавка"><h4>Лавка</h4><p>Продукты</p></div><div><img src="assets/editorial/eda.ico" alt="Яндекс Еда"><h4>Еда</h4><p>Готовые блюда</p></div><div><img src="assets/editorial/market.png" alt="Яндекс Маркет"><h4>Маркет</h4><p>Спортивный<br>инвентарь</p></div></div></div></div>`;
    value.dataset.notes += ' Предлагаемые интеграции: концепции сценариев, не заявление об уже запущенных интеграциях. Заказ подтверждает пользователь.';
    const events=document.createElement('section');
    events.className='slide ce-slide ce-events';
    events.dataset.section='07 · СПОРТИВНЫЕ СОБЫТИЯ';
    events.dataset.version='7.3';
    events.dataset.notes='Свои и партнёрские мероприятия, тренировки и челленджи. Участники знакомятся с FIT через спорт. Изображения — концепции, не отчёт о проведённых мероприятиях.';
    events.innerHTML=header('07 · ПРИВЛЕЧЕНИЕ','Спорт объединяет')+`<p class="ce-lead">Тренировки, челленджи и события FIT</p><div class="ce-event-pair"><figure><img src="assets/events/mass-start.png" alt="Концепция массового спортивного события FIT"><figcaption>Встречаемся на спортивном событии</figcaption></figure><figure><img src="assets/events/meet-fit.png" alt="Концепция знакомства с FIT на площадке"><figcaption>Знакомимся с FIT на площадке</figcaption></figure></div><p class="ce-status">Концепции мероприятий</p>`;
    acquisition.after(events);
    return events;
  }
};
