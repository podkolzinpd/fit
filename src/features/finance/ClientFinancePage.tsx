import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import type { ClientFinancePackage, ClientFinanceSummary, ClientFinanceTrainer } from '../../data/repositories/client-finance.repository'
import { ChevronRightIcon } from '../../shared/icons'
import { formatLocalDate, localDate } from '../../shared/local-date'
import { AsyncView, EmptyState, Page } from '../../shared/ui'

const PACKAGE_STATUS: Record<ClientFinancePackage['packageStatus'], string> = {
  active: 'Активен',
  upcoming: 'Скоро начнётся',
  completed: 'Завершён',
  expired: 'Истёк',
  closed: 'Закрыт',
}

function money(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', maximumFractionDigits: 0,
  }).format(value / 100)
}

function packageOrder(item: ClientFinancePackage): number {
  if (item.packageStatus === 'active') return 0
  if (item.packageStatus === 'upcoming') return 1
  return 2
}

function currentPackages(trainer: ClientFinanceTrainer): ClientFinancePackage[] {
  const sorted = [...trainer.packages].sort((a, b) => packageOrder(a) - packageOrder(b)
    || b.startsOn.localeCompare(a.startsOn))
  const current = sorted.filter((item) => item.packageStatus === 'active' || item.packageStatus === 'upcoming')
  return current.length ? current : sorted.slice(0, 1)
}

function packagePayment(item: ClientFinancePackage): string {
  return item.dueCents === 0 ? 'Оплачено' : `К оплате ${money(item.dueCents)}`
}

function packageBalance(item: ClientFinancePackage): string {
  if (item.kind === 'session_pack') return `${item.sessionsRemaining} из ${item.sessionsTotal}`
  return item.endsOn ? `До ${formatLocalDate(localDate(item.endsOn))}` : 'Онлайн'
}

export function ClientFinanceHomeContent({ finance }: { finance: ClientFinanceSummary }) {
  return <section className="client-finance-home" aria-labelledby="client-finance-home-title">
    <div className="client-finance-home-heading">
      <div><p className="eyebrow">ОПЛАТА</p><h2 id="client-finance-home-title">Услуги тренера</h2></div>
      <Link to="/me/finance">Подробнее <ChevronRightIcon /></Link>
    </div>
    <div className="client-finance-home-list">{finance.trainers.length === 0
      ? <p className="client-finance-home-empty">Услуг пока нет</p>
      : finance.trainers.map((trainer) => {
      const visible = currentPackages(trainer)
      const first = visible[0]
      if (!first) return null
      return <div className="client-finance-home-row" key={trainer.trainerId}>
        <span><strong>{trainer.trainerName}</strong><small>{first.title}{visible.length > 1 ? ` · ещё ${visible.length - 1}` : ''}</small></span>
        <span><strong>{packageBalance(first)}</strong><small>{packagePayment(first)}</small></span>
      </div>
      })}</div>
  </section>
}

export function ClientFinanceHomeCard() {
  const { clientFinance } = useDataBackend()
  const { actor } = useAuth()
  const finance = useQuery({
    queryKey: ['client-finance', actor?.userId],
    queryFn: () => clientFinance.getMine(),
    enabled: actor?.role === 'client',
  })
  if (finance.isLoading) return null
  if (finance.error) return <section className="client-finance-home" aria-labelledby="client-finance-home-title">
    <div className="client-finance-home-heading">
      <div><p className="eyebrow">ОПЛАТА</p><h2 id="client-finance-home-title">Услуги тренера</h2></div>
      <Link to="/me/finance">Подробнее <ChevronRightIcon /></Link>
    </div>
    <p className="client-finance-home-empty">Не удалось загрузить данные</p>
  </section>
  return finance.data ? <ClientFinanceHomeContent finance={finance.data} /> : null
}

function PackageCard({ item }: { item: ClientFinancePackage }) {
  const period = item.endsOn
    ? `${formatLocalDate(localDate(item.startsOn))} — ${formatLocalDate(localDate(item.endsOn))}`
    : `С ${formatLocalDate(localDate(item.startsOn))}`
  return <article className="client-finance-package">
    <header><div><span className={`client-finance-status is-${item.packageStatus}`}>{item.kind === 'online_coaching' ? 'Онлайн · ' : ''}{PACKAGE_STATUS[item.packageStatus]}</span><h3>{item.title}</h3></div><strong>{packageBalance(item)}</strong></header>
    <p className="client-finance-period">{period}</p>
    <div className="client-finance-package-money">
      <p><span>Стоимость</span><strong>{money(item.priceCents)}</strong></p>
      <p><span>Оплачено</span><strong>{money(item.paidCents)}</strong></p>
      <p><span>К оплате</span><strong>{money(item.dueCents)}</strong></p>
    </div>
    {item.paymentDueOn && item.dueCents > 0 && <p className="client-finance-due">Оплатить до {formatLocalDate(localDate(item.paymentDueOn))}</p>}
  </article>
}

function TrainerFinanceSection({ trainer }: { trainer: ClientFinanceTrainer }) {
  const packages = [...trainer.packages].sort((a, b) => packageOrder(a) - packageOrder(b)
    || b.startsOn.localeCompare(a.startsOn))
  const packageNames = new Map(packages.map((item) => [item.id, item.title]))
  return <section className="client-finance-trainer" aria-labelledby={`client-finance-trainer-${trainer.trainerId}`}>
    <div className="client-finance-section-heading"><p className="eyebrow">ТРЕНЕР</p><h2 id={`client-finance-trainer-${trainer.trainerId}`}>{trainer.trainerName}</h2></div>
    <div className="client-finance-package-list">{packages.map((item) => <PackageCard key={item.id} item={item} />)}</div>
    <section className="client-finance-payments" aria-labelledby={`client-finance-payments-${trainer.trainerId}`}>
      <h3 id={`client-finance-payments-${trainer.trainerId}`}>Оплаты</h3>
      {trainer.payments.length === 0
        ? <p className="client-finance-empty-line">Оплат пока нет.</p>
        : <div className="client-finance-payment-list">{trainer.payments.map((payment) => <div className="client-finance-payment" key={payment.id}><span><strong>{money(payment.amountCents)}</strong><small>{packageNames.get(payment.packageId) ?? 'Абонемент'}</small></span><time dateTime={payment.receivedOn}>{formatLocalDate(localDate(payment.receivedOn))}</time></div>)}</div>}
    </section>
  </section>
}

export function ClientFinanceDetails({ finance }: { finance: ClientFinanceSummary }) {
  return finance.trainers.length === 0
    ? <EmptyState title="Оплат пока нет" description="Здесь появится информация, когда тренер добавит услугу." />
    : <div className="client-finance-trainer-list">{finance.trainers.map((trainer) => <TrainerFinanceSection key={trainer.trainerId} trainer={trainer} />)}</div>
}

export function ClientFinancePage() {
  const { clientFinance } = useDataBackend()
  const { actor } = useAuth()
  const finance = useQuery({
    queryKey: ['client-finance', actor?.userId],
    queryFn: () => clientFinance.getMine(),
    enabled: actor?.role === 'client',
  })
  return <Page title="Оплата тренировок" back="/me/profile" swipeBack className="client-finance-page">
    <AsyncView loading={finance.isLoading} error={finance.error} onRetry={() => void finance.refetch()}>
      {finance.data && <ClientFinanceDetails finance={finance.data} />}
    </AsyncView>
  </Page>
}
