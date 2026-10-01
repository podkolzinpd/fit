// Approved acquisition copy; scoped to Fit Design slide 07 only.
{
  const slide = document.querySelector('[data-section="07 · ПРИВЛЕЧЕНИЕ"]');
  const content = slide.querySelector('.content');
  const rows = [...content.children];
  rows[0].querySelector('p').innerHTML = [
    'Личные договорённости с клубами и тренерами.',
    'Тренеры приглашают клиентов, клиенты — своих тренеров.',
    'За приглашённого тренера — 25% от его Pro-подписки на 12 месяцев.',
    'За приглашение друзей — бонусы.'
  ].map(text => `<span style="display:block;margin-bottom:8px">${text}</span>`).join('');
  rows[4].remove();
  rows[5].querySelector('p').textContent = 'Предлагаем иконку Fit в Go и размещения в других сервисах Яндекса, чтобы знакомить их аудиторию с Fit.';
  content.style.marginTop = '16px';
  content.style.transform = 'translateY(-24px)';
  rows.forEach(row => { row.style.padding = '12px 0'; });
  rows[0].style.padding = '16px 0';
}
