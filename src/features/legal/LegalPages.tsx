import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type PropsWithChildren } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import legalDocuments from '../../shared/legal-documents.json'
import { LEGAL_PATHS } from '../../shared/legal'
import { StatePanel, useConfirm } from '../../shared/ui'

type LegalBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; groups: Array<{ purpose: string; data: string[] }> }

interface LegalDocumentContent {
  title: string
  blocks: LegalBlock[]
}

const privacyPolicyReference = 'Политикой конфиденциальности'

const documents = legalDocuments as {
  terms: LegalDocumentContent
  privacy: LegalDocumentContent
}

function LegalShell({ title, children }: PropsWithChildren<{ title: string }>) {
  const navigate = useNavigate()
  return <main className="legal-screen ui-identity">
    <header className="legal-header">
      <button type="button" className="page-back" aria-label="Назад" onClick={() => navigate(-1)}>←</button>
      <div><span className="brand" aria-hidden="true">FIT</span><h1>{title}</h1></div>
    </header>
    <article className="legal-document">{children}</article>
    <nav className="legal-footer-links" aria-label="Юридические документы">
      <Link to={LEGAL_PATHS.terms}>Условия использования</Link>
      <Link to={LEGAL_PATHS.privacy}>Политика конфиденциальности</Link>
      <Link to={LEGAL_PATHS.deleteAccount}>Удаление аккаунта</Link>
    </nav>
  </main>
}

function renderParagraphText(text: string, linkPrivacyPolicy: boolean) {
  if (!linkPrivacyPolicy || !text.includes(privacyPolicyReference)) return text

  return text.split(privacyPolicyReference).map((part, index) => <span key={`${part}-${index}`}>
    {index > 0 && <Link to={LEGAL_PATHS.privacy}>{privacyPolicyReference}</Link>}
    {part}
  </span>)
}

function LegalDocumentBody({ document, linkPrivacyPolicy = false }: { document: LegalDocumentContent; linkPrivacyPolicy?: boolean }) {
  return document.blocks.map((block, index) => {
    const key = `${block.type}-${index}`
    if (block.type === 'heading') {
      return block.level === 2
        ? <h2 key={key}>{block.text}</h2>
        : <h3 key={key}>{block.text}</h3>
    }
    if (block.type === 'paragraph') return <p key={key}>{renderParagraphText(block.text, linkPrivacyPolicy)}</p>
    if (block.type === 'list') return <ul key={key}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
    return <div className="legal-table-wrap" key={key}>
      <table className="legal-data-table">
        <caption className="visually-hidden">Перечень обрабатываемых персональных данных</caption>
        <tbody>
          {block.groups.flatMap((group) => group.data.map((value, rowIndex) => <tr key={`${group.purpose}-${rowIndex}`}>
            {rowIndex === 0 && <th scope="rowgroup" rowSpan={group.data.length}>{group.purpose}</th>}
            <td>{value}</td>
          </tr>))}
        </tbody>
      </table>
    </div>
  })
}

export function TermsPage() {
  return <LegalShell title={documents.terms.title}>
    <LegalDocumentBody document={documents.terms} linkPrivacyPolicy />
  </LegalShell>
}

export function PrivacyPage() {
  return <LegalShell title={documents.privacy.title}>
    <LegalDocumentBody document={documents.privacy} />
  </LegalShell>
}

export function LegalAcceptanceGate({ children }: PropsWithChildren) {
  const { actor, signOut } = useAuth()
  const { source, legal: legalRepository } = useDataBackend()
  const queryClient = useQueryClient()
  const actorKey = actor === null ? null : `${source}:${actor.userId}`
  const [acceptedActorKey, setAcceptedActorKey] = useState<string | null>(null)
  const status = useQuery({
    queryKey: ['legal-acceptance', source, actor?.userId],
    queryFn: () => legalRepository.getAcceptanceStatus(),
    staleTime: Infinity,
  })
  const accept = useMutation({
    mutationFn: () => legalRepository.acceptCurrent('existing_user'),
    onSuccess: (acceptedAt) => queryClient.setQueryData(['legal-acceptance', source, actor?.userId], {
      applicable: true,
      accepted: true,
      acceptedAt,
    }),
  })

  useEffect(() => {
    if (status.data?.accepted && actorKey !== null) setAcceptedActorKey(actorKey)
  }, [actorKey, status.data?.accepted])

  // Profile refresh clears server-state queries. Keep an already accepted user
  // inside the app while the same actor's audit row is checked again.
  if ((actorKey !== null && acceptedActorKey === actorKey) || status.data?.accepted) return children
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
  const { source, legal: legalRepository } = useDataBackend()
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const status = useQuery({
    queryKey: ['account-deletion-request', source, actor?.userId],
    queryFn: () => legalRepository.getAccountDeletionStatus(),
    enabled: actor !== null,
  })
  const request = useMutation({
    mutationFn: () => legalRepository.requestAccountDeletion(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-deletion-request', source, actor?.userId] }),
  })
  const cancel = useMutation({
    mutationFn: () => legalRepository.cancelAccountDeletionRequest(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-deletion-request', source, actor?.userId] }),
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
