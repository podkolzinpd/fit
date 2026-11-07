import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { isFitLimeEnabled } from '../../app/fit-lime'
import { useDataBackend } from '../../app/data-backend-context'
import { invalidateFinanceViews } from '../../app/invalidate-finance-views'
import type { TrainerFinancePaymentDraft, TrainerFinanceReceipt } from '../../data/contracts/trainer-finance'
import { ChevronDownIcon, CloseIcon } from '../../shared/icons'
import { formatLocalDate, localDate } from '../../shared/local-date'
import { AsyncView, Field, InlineRequestError, OverflowMenu, useConfirm } from '../../shared/ui'
import { PaymentForm } from './TrainerFinancePage'
import { FinanceFilterSheet, FinanceListToolbar } from './FinanceListControls'
import { financeMoney } from './finance-monthly'

function money(cents: number) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

export function TrainerFinancePayments({ month, clientId, offset, returnTo, onClientChange, onOffsetChange, compact = false, summaryShown = false, navigation }: {
  month: string
  clientId?: string
  offset: number
  returnTo: string
  onClientChange: (clientId: string) => void
  onOffsetChange: (offset: number) => void
  compact?: boolean
  summaryShown?: boolean
  navigation?: ReactNode
}) {
  const { trainerFinance } = useDataBackend()
  const { actor } = useAuth()
  const queryClient = useQueryClient()
  const [confirm, confirmation] = useConfirm()
  const [editor, setEditor] = useState<TrainerFinanceReceipt | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const history = useQuery({
    queryKey: ['trainer-finance-payments', month, clientId ?? '', offset],
    queryFn: () => trainerFinance.listPayments(month, clientId, offset),
  })
  useEffect(() => {
    if (editor) editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [editor])
  const refresh = async (receipt: TrainerFinanceReceipt) => {
    await invalidateFinanceViews(queryClient, receipt.clientId)
  }
  const save = useMutation({
    mutationFn: ({ receipt, draft }: { receipt: TrainerFinanceReceipt; draft: TrainerFinancePaymentDraft }) =>
      trainerFinance.updatePayment(receipt.id, { ...draft, expectedVersion: receipt.version }),
    onSuccess: async (_payment, { receipt }) => { await refresh(receipt); setEditor(null) },
  })
  const remove = useMutation({
    mutationFn: (receipt: TrainerFinanceReceipt) => trainerFinance.voidPayment(receipt.id, receipt.version, 'Удалено тренером'),
    onSuccess: async (_result, receipt) => {
      await refresh(receipt)
      if (editor?.id === receipt.id) setEditor(null)
    },
  })
  const data = history.data
  const formatMoney = compact ? financeMoney : money
  const clientOptions = [{ id: '', label: 'Все клиенты' },
    ...(clientId && !data?.clients.some(client => client.id === clientId) ? [{ id: clientId, label: 'Выбранный клиент' }] : []),
    ...(data?.clients.map(client => ({ id: client.id, label: client.name })) ?? [])]
  const selectedName = clientOptions.find(client => client.id === clientId)?.label ?? 'Выбранный клиент'
  return <section className="finance-receipts" aria-label="История оплат">
    {confirmation}
    {compact && <>
      <FinanceListToolbar navigation={navigation} onFilter={() => setFiltersOpen(true)} filterOpen={filtersOpen} filtered={Boolean(clientId)} disabled={save.isPending || remove.isPending} />
      {clientId && <div className="finance-active-filter"><button type="button" disabled={save.isPending || remove.isPending} aria-label="Сбросить фильтр оплат" onClick={() => { setEditor(null); onClientChange('') }}>{selectedName}<CloseIcon /></button></div>}
      {filtersOpen && <FinanceFilterSheet label="Фильтр оплат по клиенту" value={clientId ?? ''} options={clientOptions}
        onChange={id => { setEditor(null); onClientChange(id) }} onClose={() => setFiltersOpen(false)} />}
    </>}
    {editor && <div ref={editorRef}><PaymentForm lime={isFitLimeEnabled(actor)} key={editor.id} current={editor} packageId={editor.packageId}
      today={editor.receivedOn} saving={save.isPending} error={save.error}
      onCancel={() => { if (!save.isPending) setEditor(null) }}
      onSubmit={draft => save.mutate({ receipt: editor, draft })} /></div>}
    {remove.error && <InlineRequestError error={remove.error} />}
    <AsyncView loading={history.isLoading} error={history.error} onRetry={() => void history.refetch()}>
      {data && <>
        {!compact && <Field label="Клиент"><span className="finance-receipts-filter"><select aria-label="Клиент оплат" value={clientId ?? ''} disabled={save.isPending || remove.isPending} onChange={event => { setEditor(null); onClientChange(event.target.value) }}>
          <option value="">Все клиенты</option>
          {clientId && !data.clients.some(client => client.id === clientId) && <option value={clientId}>Выбранный клиент</option>}
          {data.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select><ChevronDownIcon aria-hidden="true" /></span></Field>}
        {(!compact || !summaryShown || clientId) && <div className={`finance-payment-overview finance-receipts-total${compact ? ' finance-compact-receipts-total' : ''}`}><p><span>{clientId ? 'Получено от клиента за месяц' : 'Получено за месяц'}</span><strong>{formatMoney(data.totalCents)}</strong></p></div>}
        <div className="finance-payment-list finance-payment-ledger">{data.payments.map(receipt => <article className="finance-payment" key={receipt.id}>
          <div><Link className="finance-receipt-client" to={`/clients/${receipt.clientId}/finance${compact ? `?month=${month}&metric=money` : ''}`} state={{ financeBackTo: returnTo }}>{receipt.clientName}</Link>
            <strong>{formatMoney(receipt.amountCents)}</strong>
            <span>{formatLocalDate(localDate(receipt.receivedOn))}{receipt.source === 'opening' ? ' · Начальный оплаченный остаток' : ''}</span>
            {receipt.archivedAt && <span>В архиве</span>}
            {receipt.comment && !(receipt.source === 'opening' && receipt.comment.trim() === 'Начальный оплаченный остаток') && <span className="finance-receipt-comment">{receipt.comment}</span>}
          </div>
          <span className="finance-payment-package">{receipt.serviceTitle}</span>
          <OverflowMenu label={`Действия с оплатой ${receipt.clientName} ${formatMoney(receipt.amountCents)}`} items={[
            { label: 'Изменить', disabled: save.isPending || remove.isPending, onClick: () => { save.reset(); setEditor(receipt) } },
            { label: 'Удалить', danger: true, disabled: save.isPending || remove.isPending, onClick: () => void confirm({
              message: `Удалить оплату ${formatMoney(receipt.amountCents)} от ${formatLocalDate(localDate(receipt.receivedOn))}?`,
              confirmLabel: 'Удалить', danger: true,
            }).then(ok => { if (ok) remove.mutate(receipt) }) },
          ]} />
        </article>)}</div>
        {data.totalCount === 0 && <p className="finance-empty">Оплат за этот месяц нет.</p>}
        {data.totalCount > data.limit && data.payments.length > 0 && <div className="actions finance-receipts-pages" aria-label="Страницы оплат">
          <button type="button" disabled={offset === 0 || save.isPending || remove.isPending} onClick={() => onOffsetChange(Math.max(0, offset - data.limit))}>Предыдущие</button>
          <span>{offset + 1}–{Math.min(offset + data.payments.length, data.totalCount)} из {data.totalCount}</span>
          <button type="button" disabled={offset + data.limit >= data.totalCount || save.isPending || remove.isPending} onClick={() => onOffsetChange(offset + data.limit)}>Следующие</button>
        </div>}
        {offset > 0 && data.payments.length === 0 && <button type="button" onClick={() => onOffsetChange(0)}>К первым оплатам</button>}
      </>}
    </AsyncView>
  </section>
}
