// Calm palette: recolour presentation primitives only; product screenshots remain intact.
const designPalette = {
  '#91bea6':'#d6f500', '#69947e':'#d6f500', 'rgb(145, 190, 166)':'#d6f500',
  '#bdc3ce':'#b7bcbe', 'rgb(189, 195, 206)':'#b7bcbe', '#929da9':'#a7acae',
  '#f5f3ee':'#f5f4ef', '#414a57':'#363e42', '#68717e':'#687276',
  '#9aabb4':'#a7acae', '#56616e':'#566166', '#46515e':'#465055', '#35414e':'#333c40',
  'rgb(114, 127, 141)':'#899396', '#2f6b4f':'#334000', '#74736f':'#414b26',
  'rgb(245, 243, 238)':'#f5f4ef'
};
document.querySelectorAll('#deck > .slide:not(:first-child) [style], #deck svg [fill]').forEach(el => {
  if (el.tagName === 'IMG') return;
  for (const attr of ['style','fill']) {
    let value=el.getAttribute(attr); if (!value) continue;
    for (const [from,to] of Object.entries(designPalette)) value=value.split(from).join(to);
    el.setAttribute(attr,value);
  }
});
document.querySelectorAll('#deck > .slide:not(:first-child) > .eyebrow').forEach(el => {
  el.innerHTML=el.textContent.replace(/^(\d+)/,'<span class="design-number">$1</span>');
});
// Слайд 10 пересобран 01.10.2026 (график выручки и затрат) — выделение финального года колонкой больше не нужно.
document.querySelectorAll('.idea-polished h3').forEach(el => el.style.color='#f5f4ef');
const synthesis=document.querySelector('.superapp-simple .content > div:first-of-type p');
synthesis.style.color='#f5f4ef';
synthesis.innerHTML=synthesis.innerHTML.replace('Fit','<span style="color:#d6f500">Fit</span>');
document.title='Fit Design — презентация';

// Market subtitle: keep the forecast compact and its source visually separate.
const marketForecast = document.querySelector('.market-polished svg text[x="754"][y="64"]');
if (marketForecast) {
  marketForecast.textContent = '≈1,5 трлн ₽ (2025) → ≈2,3 трлн ₽ (2031)';
  const source = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  source.setAttribute('x', '1410');
  source.setAttribute('y', '64');
  source.setAttribute('text-anchor', 'end');
  source.setAttribute('font-size', '16');
  source.style.fontSize = '16px';
  source.setAttribute('fill', '#a7acae');
  source.textContent = 'Оценка Fit';
  marketForecast.after(source);
  document.querySelector('.market-polished svg text[x="804"][y="94"]')?.remove();
}
