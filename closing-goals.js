/* Final / vision: apple/09 composition only — one dominant outcome and a quieter ask.
   Fit palette, typography and approved content remain the source of identity. */
(()=>{
  const slide=document.querySelector('#deck>[data-section="14 · ЧТО НУЖНО СЕЙЧАС"]');
  if(!slide)return;
  const reserve=document.createElement('template');
  reserve.id='closing-before-goals-first';
  reserve.content.append(slide.cloneNode(true));
  document.body.append(reserve);
  slide.id='closing-goals-first';
  slide.dataset.version='13.2';
  slide.dataset.notes='Цели на конец третьего месяца: 300 тренеров, реально ведущих клиентов в Fit, 5 000 уникальных активных клиентов за месяц, готовый платёжный MVP. Это согласованные целевые KPI, а не текущие фактические показатели и не результат пересчёта Excel. Финмодель пока сохранена без изменений; достижение новых целей требует уточнения плана привлечения и бюджета. Запрос 16 млн ₽ сохранён по предыдущему слайду: текущая модель оценивает первые три месяца в 16,2 млн ₽. Команда к концу этапа — 9,5 FTE. Сохраняем срок запуска платежей с четвёртого месяца. Интеграции и доступ к внутренней аудитории — запрос на поддержку, а не утверждение о согласованных размещениях.';
  slide.innerHTML=`
    <div class="eyebrow"><span style="color:#d6f500">14</span> · ЧТО НУЖНО СЕЙЧАС</div>
    <h2>Поддержать первый этап Fit</h2>
    <div class="cg-grid">
      <div class="cg-outcome">
        <div class="cg-label">РЕЗУЛЬТАТ ПЕРВЫХ 3 МЕСЯЦЕВ</div>
        <h3>Стабильный продукт<br>и готовые платежи</h3>
        <p class="cg-description">Подтверждение тренировок и ИИ для тренеров.<br>Оплата по СБП с комиссией и чеками — с 4-го месяца.</p>
        <div class="cg-kpis">
          <div class="cg-label">ЦЕЛИ НА КОНЕЦ ЭТАПА</div>
          <div class="cg-kpi-row">
            <div class="cg-kpi"><div class="cg-number">300</div><p>тренеров,<br>ведущих клиентов</p></div>
            <div class="cg-kpi cg-main-kpi"><div class="cg-number">5 000</div><p>активных клиентов<br>в месяц · MAU</p></div>
            <div class="cg-kpi cg-mvp"><div class="cg-number">Готов</div><p>Платёжный MVP</p></div>
          </div>
        </div>
      </div>
      <div class="cg-ask">
        <div class="cg-label">ЧТО ПРОСИМ</div>
        <div class="cg-amount">16 млн ₽</div>
        <p class="cg-funding">Команда и первые 3 месяца работы</p>
        <p class="cg-team">9,5 FTE к концу этапа</p>
        <div class="cg-support">
          <div><h3>Интеграции</h3><p>Мессенджер · Телемост<br>Pay · Сплит</p></div>
          <div><h3>Первая аудитория</h3><p>Запуск среди сотрудников Яндекса</p></div>
          <div><h3>Выход на рынок</h3><p>Согласование бренда<br>и релиза в сторах</p></div>
        </div>
      </div>
    </div>`;
})();
