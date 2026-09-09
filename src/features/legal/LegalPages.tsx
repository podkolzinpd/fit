import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type PropsWithChildren } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { legalRepository } from '../../data/repositories/legal.repository'
import { LEGAL_PATHS, LEGAL_REVISION_LABEL } from '../../shared/legal'
import { StatePanel, useConfirm } from '../../shared/ui'

function LegalShell({ title, children }: PropsWithChildren<{ title: string }>) {
  const navigate = useNavigate()
  return <main className="legal-screen ui-identity">
    <header className="legal-header">
      <button type="button" className="page-back" aria-label="Назад" onClick={() => navigate(-1)}>←</button>
      <div><span className="brand" aria-hidden="true">FIT</span><h1>{title}</h1><p>Редакция от {LEGAL_REVISION_LABEL}</p></div>
    </header>
    <article className="legal-document">{children}</article>
    <nav className="legal-footer-links" aria-label="Юридические документы">
      <Link to={LEGAL_PATHS.terms}>Условия использования</Link>
      <Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link>
      <Link to={LEGAL_PATHS.deleteAccount}>Удаление аккаунта</Link>
    </nav>
  </main>
}

export function TermsPage() {
  return <LegalShell title="Условия использования">
    <p>Эти Условия регулируют использование сервиса Fit. Администратор предоставляет Fit, а зарегистрированный пользователь использует его как тренер или спортсмен.</p>

    <h2>1. Аккаунт</h2>
    <p>Для работы с Fit нужен аккаунт. При регистрации укажите актуальные имя и email, придумайте пароль и выберите роль. Вы отвечаете за сохранность данных для входа и действия в своём аккаунте.</p>
    <p>Самостоятельно создавать аккаунт может совершеннолетний пользователь. Данные несовершеннолетнего спортсмена можно добавлять только при наличии согласия его законного представителя.</p>

    <h2>2. Возможности Fit</h2>
    <p>Тренер может вести клиентов, составлять тренировки, смотреть результаты и обмениваться данными со спортсменом. Спортсмен может выполнять тренировки, записывать результаты и следить за прогрессом.</p>
    <p>Связь тренера и спортсмена создаётся по коду приглашения. После подключения им становятся доступны данные, необходимые для совместной работы. Связь можно отключить в профиле.</p>

    <h2>3. Тренировки и здоровье</h2>
    <p>Fit помогает вести тренировочный процесс, но не заменяет врача и не гарантирует спортивный результат. Пользователь сам оценивает своё состояние и прекращает тренировку при боли или плохом самочувствии.</p>
    <p>Тренер отвечает за свои программы и рекомендации. Администратор не является работодателем тренера и не участвует в расчётах между тренером и спортсменом.</p>

    <h2>4. Ассистент</h2>
    <p>Тренеру и спортсмену могут быть доступны функции с искусственным интеллектом. Ассистент помогает разобрать запись тренировки и объяснить уже рассчитанные показатели. Его ответы носят справочный характер, могут содержать ошибки и не являются медицинской консультацией.</p>

    <h2>5. Данные и материалы</h2>
    <p>Пользователь может добавлять результаты тренировок, параметры тела, цели, самочувствие, комментарии и другие данные, доступные в интерфейсе. Пользователь подтверждает, что вправе передавать эти данные в Fit и показывать их связанному тренеру или спортсмену.</p>
    <p>Нельзя размещать незаконные материалы, угрозы, оскорбления, дискриминационные высказывания или данные третьих лиц без законного основания. Такой контент может быть ограничен или удалён.</p>

    <h2>6. Работа сервиса</h2>
    <p>Fit развивается, поэтому функции могут меняться, временно отключаться или становиться недоступными на время обновления. Администратор старается сохранять данные и стабильность сервиса, но не обещает непрерывную работу без ошибок.</p>

    <h2>7. Персональные данные</h2>
    <p>Обработка данных описана в <Link to={LEGAL_PATHS.privacy}>Политике конфиденциальности</Link>. Запросить удаление аккаунта можно на странице <Link to={LEGAL_PATHS.deleteAccount}>«Удаление аккаунта»</Link>.</p>

    <h2>8. Изменение Условий</h2>
    <p>Новая редакция действует с даты публикации. Если изменения требуют нового согласия, Fit попросит принять документы перед продолжением работы.</p>
  </LegalShell>
}

export function PrivacyPage() {
  return <LegalShell title="Политика конфиденциальности">
    <p>Эта Политика объясняет, какие данные обрабатывает Fit, зачем они нужны и кому могут быть доступны. Оператором данных является Администратор сервиса Fit.</p>

    <h2>1. Как связаться</h2>
    <p>По вопросам о данных войдите в Fit и откройте «Профиль» → «Предложение или проблема». Запрос на удаление аккаунта можно подать на <Link to={LEGAL_PATHS.deleteAccount}>отдельной странице</Link>.</p>

    <h2>2. Какие данные обрабатываются</h2>
    <ul>
      <li>аккаунт: имя, email, роль и технические данные авторизации;</li>
      <li>профиль спортсмена: пол, возраст, рост, вес, замеры, цели и заметки;</li>
      <li>тренировки: планы, упражнения, подходы, результаты, нагрузка, самочувствие, дискомфорт и комментарии;</li>
      <li>совместная работа: связи тренера и спортсмена, приглашения, сообщения и отзывы;</li>
      <li>устройство: браузер, версия приложения, IP-адрес, cookies, push-подписка и диагностические события;</li>
      <li>ассистент: запросы, расшифровки речи, контекст тренировки, ответы и принятые пользователем действия.</li>
    </ul>
    <p>Fit не хранит пароль в открытом виде. Авторизационные данные защищает используемый сервис входа.</p>

    <h2>3. Зачем нужны данные</h2>
    <p>Данные нужны, чтобы создать и защитить аккаунт, показывать тренировки и прогресс, связывать тренера со спортсменом, отправлять выбранные уведомления, отвечать на обращения, обеспечивать безопасность и улучшать Fit.</p>
    <p>Основания обработки: исполнение условий использования, согласие пользователя, выполнение требований закона и законный интерес в защите и развитии сервиса.</p>

    <h2>4. Кто видит данные</h2>
    <p>Связанный тренер видит данные спортсмена, необходимые для ведения тренировок. Спортсмен видит сведения о подключённом тренере и назначенные ему материалы. После отключения связи новый общий доступ прекращается, но данные могут храниться в пределах сроков, описанных ниже.</p>
    <p>Для работы Fit используются поставщики облачной инфраструктуры, авторизации, хранилища, аналитики, push-уведомлений и искусственного интеллекта. Сейчас к этой обработке могут привлекаться Supabase, Vercel и сервисы Yandex Cloud. Им передаётся только тот объём данных, который нужен для конкретной функции.</p>

    <h2>5. Искусственный интеллект</h2>
    <p>Если пользователь запускает разбор или ассистента, Fit может передать Yandex Cloud текст запроса и относящийся к нему контекст тренировки. Числовые показатели рассчитывает Fit; модель формирует пояснение или предложение. Не добавляйте в запросы лишние сведения о себе и других людях.</p>

    <h2>6. Уведомления и аналитика</h2>
    <p>Push-уведомления отправляются только после разрешения устройства. Их можно отключить в профиле Fit или системных настройках. Для понимания использования экранов и ошибок Fit может применять обезличенные или технические события аналитики.</p>

    <h2>7. Хранение и передача</h2>
    <p>Данные хранятся, пока нужен аккаунт и функции Fit, а после запроса на удаление — только в течение срока, необходимого для выполнения запроса, защиты от злоупотреблений и соблюдения закона. Резервные копии удаляются по циклу обновления хранилища.</p>
    <p>География обработки зависит от инфраструктуры поставщиков. При передаче данных применяются доступные договорные и технические меры защиты и требования применимого законодательства.</p>

    <h2>8. Права пользователя</h2>
    <p>Пользователь может просить доступ к своим данным, исправление, ограничение обработки, отзыв согласия и удаление данных, если это предусмотрено законом. Основные данные можно исправить в профиле. Удаление запускается на странице <Link to={LEGAL_PATHS.deleteAccount}>«Удаление аккаунта»</Link>.</p>

    <h2>9. Защита данных</h2>
    <p>Fit ограничивает доступ по ролям, использует защищённое соединение и проверяет права на операции. Доступ сотрудников и подрядчиков допускается только для поддержки, безопасности и выполнения обязанностей сервиса.</p>

    <h2>10. Изменения Политики</h2>
    <p>Актуальная редакция всегда опубликована по этому адресу. При существенном изменении обработки Fit попросит пользователя принять новую редакцию.</p>
  </LegalShell>
}

export function LegalAcceptanceGate({ children }: PropsWithChildren) {
  const { actor, signOut } = useAuth()
  const queryClient = useQueryClient()
  const [acceptedUserId, setAcceptedUserId] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ['legal-acceptance', actor?.userId],
    queryFn: () => legalRepository.getAcceptanceStatus(),
    staleTime: Infinity,
  })
  const accept = useMutation({
    mutationFn: () => legalRepository.acceptCurrent('existing_user'),
    onSuccess: () => queryClient.setQueryData(['legal-acceptance', actor?.userId], {
      applicable: true,
      accepted: true,
      acceptedAt: new Date().toISOString(),
    }),
  })

  useEffect(() => {
    if (status.data?.accepted && actor) setAcceptedUserId(actor.userId)
  }, [actor, status.data?.accepted])

  // Profile refresh clears server-state queries. Keep an already accepted user
  // inside the app while the same actor's audit row is checked again.
  if (acceptedUserId === actor?.userId || status.data?.accepted) return children
  if (status.isLoading) return <main className="legal-gate ui-identity"><p>Проверяем документы…</p></main>
  if (status.error) return <main className="legal-gate ui-identity"><StatePanel
    tone="error"
    title="Не удалось проверить документы"
    description={status.error.message}
    action={<div className="stack"><button type="button" onClick={() => void status.refetch()}>Повторить</button><button type="button" className="secondary" onClick={() => void signOut()}>Выйти</button></div>}
  /></main>
  return <main className="legal-gate ui-identity">
    <div className="brand" aria-hidden="true">FIT</div>
    <section className="legal-gate-card">
      <p className="eyebrow">ДОКУМЕНТЫ FIT</p>
      <h1>Условия обновились</h1>
      <p>Прочитайте документы и примите их, чтобы продолжить.</p>
      <div className="legal-gate-links"><Link to={LEGAL_PATHS.terms}>Условия использования</Link><Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link></div>
      {accept.error && <p className="error" role="alert">{accept.error.message}</p>}
      <button type="button" className="primary" disabled={accept.isPending} onClick={() => accept.mutate()}>{accept.isPending ? 'Сохраняем…' : 'Принять и продолжить'}</button>
      <button type="button" className="secondary" onClick={() => void signOut()}>Выйти</button>
    </section>
  </main>
}

export function AccountDeletionPage() {
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const status = useQuery({
    queryKey: ['account-deletion-request', actor?.userId],
    queryFn: () => legalRepository.getAccountDeletionStatus(),
    enabled: actor !== null,
  })
  const request = useMutation({
    mutationFn: () => legalRepository.requestAccountDeletion(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-deletion-request', actor?.userId] }),
  })
  const cancel = useMutation({
    mutationFn: () => legalRepository.cancelAccountDeletionRequest(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-deletion-request', actor?.userId] }),
  })

  return <LegalShell title="Удаление аккаунта">
    <p>Здесь можно отправить запрос на удаление аккаунта Fit и связанных с ним данных.</p>
    {!actor && <StatePanel
      tone="info"
      title="Сначала войдите"
      description="Вход нужен, чтобы подтвердить владельца аккаунта."
      action={<Link className="button primary" to="/auth" state={{ from: LEGAL_PATHS.deleteAccount }}>Войти в Fit</Link>}
    />}
    {actor && status.isLoading && <p role="status">Проверяем запрос…</p>}
    {actor && status.error && <StatePanel tone="error" title="Не удалось проверить запрос" description={status.error.message} action={<button type="button" onClick={() => void status.refetch()}>Повторить</button>} />}
    {actor && status.data?.supported === false && <StatePanel tone="info" title="Напишите в поддержку" description="Откройте профиль Fit и выберите «Предложение или проблема»." />}
    {actor && status.data?.supported && status.data.request && <StatePanel
      tone="info"
      title="Запрос принят"
      description={`Отправлен ${new Intl.DateTimeFormat('ru-RU').format(new Date(status.data.request.requestedAt))}. Аккаунт пока работает, данные ещё не удалены.`}
      action={<button type="button" className="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{cancel.isPending ? 'Отменяем…' : 'Отменить запрос'}</button>}
    />}
    {actor && status.data?.supported && !status.data.request && <section className="legal-delete-card">
      <h2>Что произойдёт</h2>
      <p>Мы получим заявку, проверим её и удалим аккаунт и связанные данные в установленный законом срок. Отправка заявки ничего не удаляет сразу.</p>
      <button type="button" className="danger secondary" disabled={request.isPending} onClick={async () => {
        const ok = await confirm({
          message: 'Отправить запрос на удаление аккаунта?',
          confirmLabel: 'Отправить запрос',
          danger: true,
        })
        if (ok) request.mutate()
      }}>{request.isPending ? 'Отправляем…' : 'Запросить удаление аккаунта'}</button>
    </section>}
    {(request.error || cancel.error) && <p className="error" role="alert">{(request.error ?? cancel.error)?.message}</p>}
    {confirmDialog}
  </LegalShell>
}
