/* Approved 384 × 808 device. Navigation follows AppLayout.tsx, not invented tabs. */
(() => {
 const paths={home:'<path d="m3 10 9-7 9 7"/><path d="M5.5 9v11h13V9M9.5 20v-6h5v6"/>',progress:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="m4 7 5-3 6 5 5-4"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4 3.2-6.3 7.5-6.3s6.9 2.3 7.5 6.3"/>',today:'<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.1 2.4 2.4 5.2-5.2"/>',clients:'<path d="M16 20v-1.7c0-2.2-1.8-4-4-4H6.5c-2.2 0-4 1.8-4 4V20"/><circle cx="9.25" cy="7.4" r="3.4"/><path d="M15.2 4.2a3.4 3.4 0 0 1 0 6.5M17.2 14.5c2.4.35 4.3 1.95 4.3 4V20"/>'};
 const icon=n=>{const asset=({today:'checkbox',clients:'users'})[n];return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${asset?`<image href="assets/device-${asset}.svg" width="24" height="24"/>`:paths[n]||`<image href="assets/device-${n}.svg" width="24" height="24"/>`}</svg>`;};
 const client=[['home','Кабинет'],['calendar','Тренировки'],['assistant','Ассистент'],['progress','Прогресс'],['profile','Профиль']];
 const trainer=[['today','День'],['calendar','Расписание'],['clients','Клиенты'],['assistant','Ассистент']];
 document.querySelectorAll('#deck .cs-phone,#deck .ca-phone .ca-app,#deck .fit-trainer-iphone').forEach(phone=>{
   phone.classList.add('fit-unified');
   const hardware=document.createElement('div');hardware.className='du-hardware';hardware.setAttribute('aria-hidden','true');
   hardware.innerHTML='<i class="du-mute"></i><i class="du-volume-up"></i><i class="du-volume-down"></i><i class="du-power"></i><i class="du-camera"></i>';
   phone.append(hardware);
   const isTrainer=phone.classList.contains('fit-trainer-iphone');
   const scene=phone.closest('.slide');
   const market=!!phone.querySelector('.tc-marketplace');
   let active=isTrainer&&!market?(phone.querySelector('.tc-ai')?'assistant':phone.querySelector('.tc-finance')?'calendar':'clients'):scene.classList.contains('ca-phone')||scene.classList.contains('cs-voice')?'assistant':scene.classList.contains('progress-month')?'progress':scene.classList.contains('cs-coach')?'calendar':'home';
   const nav=document.createElement('nav');nav.className='du-nav';nav.setAttribute('aria-label','Основная навигация приложения');
   nav.innerHTML=(isTrainer&&!market?trainer:client).map(([key,label])=>`<span data-tab="${key}" ${key===active?'class="active" aria-current="page"':''}>${icon(key)}<small>${label}</small></span>`).join('');
   phone.querySelectorAll('.fn-nav,.cs-feed-nav').forEach(n=>n.remove());phone.append(nav);
   if(scene.classList.contains('ca-phone')){
     const update=()=>{const selected=scene.dataset.caStep==='2'?'calendar':'assistant';nav.querySelectorAll('[data-tab]').forEach(t=>{t.classList.toggle('active',t.dataset.tab===selected);if(t.dataset.tab===selected)t.setAttribute('aria-current','page');else t.removeAttribute('aria-current');});};
     new MutationObserver(update).observe(scene,{attributes:true,attributeFilter:['data-ca-step']});update();
   }
 });
})();
