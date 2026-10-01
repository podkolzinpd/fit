// Approved acquisition copy; scoped to Fit Design slide 07 only.
{
  const slide = document.querySelector('[data-section="07 · ПРИВЛЕЧЕНИЕ"]');
  const content = slide.querySelector('.content');
  const rows = [...content.children];
  rows[0].querySelector('p').innerHTML = [
    'Личные договорённости с клубами и тренерами.',
    'Тренер ведёт программу в Fit и приглашает своих клиентов. Клиенты приглашают своих тренеров.',
    'Партнёрская программа: тренер получает 25% от Pro-подписки приглашённого тренера в течение 12 месяцев.',
    'Пользователи приглашают знакомых в Fit и получают бонусы.'
  ].map(text => `<span style="display:block;margin-bottom:8px">${text}</span>`).join('');
  rows[4].remove();
  rows[5].querySelector('p').textContent = 'Предлагаем иконку Fit в Go и размещения в других сервисах Яндекса, чтобы знакомить их аудиторию с Fit.';
  content.style.marginTop = '16px';
  content.style.transform = 'translateY(-24px)';
  rows.forEach(row => { row.style.padding = '12px 0'; });
  rows[0].style.padding = '16px 0';
}
