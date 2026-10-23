// Functional QR overlays; approved photographs and slide content stay unchanged.
(()=>{
 const url='https://fit-training.ru/auth';
 const makeLink=()=>{
   const a=document.createElement('a');
   a.href=url;a.target='_blank';a.rel='noopener noreferrer';
   a.setAttribute('aria-label','Открыть приложение ФИТ');
   a.innerHTML='<img src="assets/qr/fit-app.png" alt="QR-код: открыть приложение ФИТ">';
   return a;
 };
 const closing=document.querySelector('#closing-goals-first');
 if(closing){
   const a=makeLink();a.className='fit-app-qr';
   a.insertAdjacentHTML('afterbegin','<span><strong>Попробовать ФИТ</strong><small>fit-training.ru</small></span>');
   closing.append(a);
 }
 document.querySelectorAll('.ce-event-pair img[src="assets/events/meet-fit.png"]').forEach(photo=>{
   const frame=document.createElement('div');frame.className='fit-event-qr-frame';
   photo.replaceWith(frame);frame.append(photo);
   const a=makeLink();a.className='fit-event-qr';a.title='Открыть ФИТ';a.querySelector('img').src='assets/qr/fit-app-small.png';frame.append(a);
 });
})();
