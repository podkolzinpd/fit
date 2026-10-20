import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../app/auth-context'
import { useDataBackend } from '../../app/data-backend-context'
import { isNutritionPilotEnabled } from '../../app/feature-flags'
import { isRepositoryConflict, RepositoryError } from '../../data/repositories/error'
import { addDays, currentTimeInTimeZone, formatLocalDate, localDate, todayInTimeZone, type LocalDate } from '../../shared/local-date'
import { NUTRITION_MEALS, nutritionNumber, scaledNutrition, type NutritionConnection, type NutritionDraft, type NutritionEntry, type NutritionFood, type NutritionValues } from '../../shared/nutrition'
import { BackIcon, ChevronRightIcon } from '../../shared/icons'
import { AsyncView, Coachmark, Field, InlineRequestError, OverflowMenu, Page, SaveStatus, Skeleton, Switch, useConfirm } from '../../shared/ui'
import { nutritionDecimal, readNutritionForm, removeNutritionForm, storeNutritionForm, type NutritionForm } from './draft'
import { parseFoodText } from './free-text'
import { BarcodePhotoPicker, BarcodeScanner } from './BarcodeScanner'
import './nutrition.css'
import { ChatStartButton } from '../chat'
import { VoiceInputButton } from '../voice-input'

const queryKey = (userId: string) => ['nutrition', userId] as const
function selectedDate(text: string | null, today: LocalDate): LocalDate {
  try { return text && text >= '1900-01-01' && text <= '2100-12-31' ? localDate(text) : today } catch { return today }
}
function Totals({ values, summary = false }: { values: NutritionValues; summary?: boolean }) {
  return <div className="nutrition-totals"><strong>{nutritionNumber(values.calories)} ккал</strong>
    {summary && <small className="muted">Записано за день</small>}
    {summary ? <div className="nutrition-summary-macros">{([
      ['protein', 'Б', 'Белки'], ['fat', 'Ж', 'Жиры'], ['carbs', 'У', 'Углеводы'],
    ] as const).map(([key, label, name]) => <span key={key} aria-label={`${name}: ${nutritionNumber(values[key])}${values[key] === null ? ', нет данных' : ' г'}`}>
      {label} {nutritionNumber(values[key])}{values[key] === null ? '' : ' г'}
    </span>)}</div> : <span>Б {nutritionNumber(values.protein)} · Ж {nutritionNumber(values.fat)} · У {nutritionNumber(values.carbs)} г</span>}
    {[values.protein, values.fat, values.carbs].some((value) => value === null) && <small>— нет данных; итог БЖУ неполный</small>}
  </div>
}
function useNutritionDay(date: LocalDate, clientId?: string) {
  const { actor } = useAuth(), { nutrition } = useDataBackend()
  return useQuery({ queryKey: [...queryKey(actor?.userId ?? ''), 'day', clientId ?? 'own', date],
    queryFn: () => nutrition.day(date, clientId), enabled: !!actor && isNutritionPilotEnabled(actor.userId, actor.experiments?.nutrition),
    staleTime: 0, refetchInterval: clientId ? 15_000 : false, retry: false })
}
export function NutritionSummary({ clientId }: { clientId?: string }) {
  const { actor } = useAuth(), today = todayInTimeZone(actor?.timezone)
  const day = useNutritionDay(today, clientId)
  if (!actor || !isNutritionPilotEnabled(actor.userId, actor.experiments?.nutrition)) return null
  // A pilot trainer also has clients outside this independent pilot. Their
  // cards must not display a broken nutrition feature or invite activation.
  if (clientId && day.error instanceof RepositoryError && day.error.code === 'PT403') return null
  const path = clientId ? `/clients/${clientId}/nutrition` : '/me/nutrition'
  return <Coachmark id={`nutrition-${clientId ? 'trainer' : 'client'}-20261010`} userId={actor.userId}
    title="Дневник питания" description={clientId ? 'Записи клиента появятся здесь, когда он разрешит вам просмотр.' : 'Выберите еду и количество — калории посчитаются автоматически.'}>
    <section className="nutrition-summary" aria-label="Питание сегодня" aria-busy={day.isLoading}>
      <header className="nutrition-summary-heading"><h2>Питание сегодня</h2>
        <Link className="link nutrition-summary-open" aria-label="Открыть дневник" to={`${path}?date=${today}`}>Дневник<ChevronRightIcon /></Link>
      </header>
      <div className="nutrition-summary-content">
      {day.isLoading ? <Skeleton rows={1} /> : day.error ? <div className="nutrition-summary-error">
        <InlineRequestError error={day.error} message="Не удалось загрузить питание." />
        <button type="button" className="link" onClick={() => void day.refetch()}>Повторить</button>
      </div> : <>
        {day.data?.access === 'locked' ? <p className="muted">Клиент пока не разрешил просмотр дневника.</p>
          : day.data?.access === 'granted' && (day.data.entries.length ? <><Totals values={day.data.totals} summary />
            {clientId && <small className="muted">Записей: {day.data.entries.length} · Обновлено в {new Date(Math.max(...day.data.entries.map((entry) => Date.parse(entry.updatedAt)))).toLocaleTimeString('ru-RU', { timeZone: actor.timezone || 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })}</small>}
          </> : <p className="muted">Сегодня записей нет</p>)}
        {clientId && day.data?.access === 'granted' && !day.data.entries.length && day.data.lastRecordedDay && day.data.lastRecordedDay !== today &&
          <Link className="link" to={`${path}?date=${day.data.lastRecordedDay}`}>Последние записи: {formatLocalDate(localDate(day.data.lastRecordedDay))}</Link>}
      </>}
      </div>
      {!clientId && <Link className="button secondary nutrition-summary-add" to={`${path}?date=${today}&action=add`}>Добавить еду</Link>}
    </section>
  </Coachmark>
}

function ConsentSettings({ userId }: { userId: string }) {
  const { nutrition } = useDataBackend(), cache = useQueryClient()
  const connections = useQuery({ queryKey: [...queryKey(userId), 'consents'], queryFn: () => nutrition.consents(), staleTime: 0, retry: false })
  const mutation = useMutation({ mutationFn: ({ connection, granted }: { connection: NutritionConnection; granted: boolean }) => nutrition.setConsent(connection, granted),
    onSuccess: () => cache.invalidateQueries({ queryKey: queryKey(userId) }) })
  return <details className="nutrition-consents"><summary>Кто видит мой дневник</summary>
    <p className="muted">По умолчанию дневник видите только вы. Разрешение открывает тренеру все записанные дни без возможности редактирования. Можно отозвать в любой момент.</p>
    <AsyncView loading={connections.isLoading} error={connections.error} onRetry={() => void connections.refetch()}>
      {connections.data?.length === 0 && <p className="muted">Подключённых тренеров с доступом к этой функции пока нет.</p>}
      {connections.data?.map((connection) => <Switch key={`${connection.clientId}.${connection.trainerId}.${connection.connectionStartedAt}`}
        label={`Разрешить просмотр: ${connection.name}`} checked={connection.granted} disabled={mutation.isPending}
        onChange={(granted) => mutation.mutate({ connection, granted })} />)}
    </AsyncView>
    <SaveStatus status={mutation.isPending ? 'saving' : mutation.isError ? 'error' : mutation.isSuccess ? 'saved' : 'idle'} error="Не удалось изменить доступ. Повторите переключение; прежнее разрешение пока сохраняется." />
  </details>
}

function FoodForm({ userId, date, existing, onSaved, onBack }: {
  userId: string; date: LocalDate; existing?: NutritionEntry; onSaved: (entry: NutritionEntry) => void; onBack: () => void
}) {
  const { nutrition } = useDataBackend(), { actor } = useAuth()
  const key = existing?.id ?? 'new', hour = Number(currentTimeInTimeZone(actor?.timezone).slice(0, 2))
  const defaults: NutritionForm = { id: existing?.id ?? crypto.randomUUID(), expectedVersion: existing?.version ?? 0,
    date: existing?.day ?? date, meal: existing?.meal ?? (hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : hour < 22 ? 'dinner' : 'snack'),
    grams: existing?.grams?.toString() ?? '', manual: existing?.basis === 'portion', per100: existing?.basis === '100g',
    name: existing?.name ?? '', calories: existing?.calories.toString() ?? '', protein: existing?.protein?.toString() ?? '',
    fat: existing?.fat?.toString() ?? '', carbs: existing?.carbs?.toString() ?? '', search: '', selection: existing ?? null }
  const form = useForm<NutritionForm>({ defaultValues: readNutritionForm(userId, key) ?? defaults })
  const values = useWatch({ control: form.control }), selection = values.selection, manual = values.manual
  const selectedServing = selection && 'servings' in selection ? selection.servings?.[0] : undefined
  const selectedServingGrams = selectedServing?.grams ?? null
  const [storageError, setStorageError] = useState(false), [search, setSearch] = useState('')
  const [suggestedGrams, setSuggestedGrams] = useState<string | null>(null)
  const [portionMode, setPortionMode] = useState(false), [portionCount, setPortionCount] = useState('1')
  const parsedSearch = useRef<string | null>(null)
  const [barcode, setBarcode] = useState(''), [barcodeError, setBarcodeError] = useState<string | null>(null), [barcodePending, setBarcodePending] = useState(false), [scannerOpen, setScannerOpen] = useState(false), [manualBarcodeEntry, setManualBarcodeEntry] = useState(false)
  const cache = useQueryClient(), active = useRef(true), [confirm, dialog] = useConfirm()
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    const raw = values.search?.trim() ?? '', parsed = parseFoodText(raw)
    const singleWithGrams = parsed.length === 1 && parsed[0]?.grams !== null ? parsed[0] : null
    if (singleWithGrams) setSuggestedGrams(String(singleWithGrams.grams))
    else if (parsedSearch.current !== parsed[0]?.name) setSuggestedGrams(null)
    const timer = setTimeout(() => setSearch(singleWithGrams?.name ?? raw), 600)
    return () => clearTimeout(timer)
  }, [values.search])
  useEffect(() => { setStorageError(!storeNutritionForm(userId, key, form.getValues())) }, [values, userId, key])
  const recent = useQuery({ queryKey: [...queryKey(userId), 'recent'], queryFn: () => nutrition.recent(), retry: false })
  const foods = useInfiniteQuery({ queryKey: [...queryKey(userId), 'search', search], initialPageParam: 1,
    queryFn: ({ pageParam }) => nutrition.search(search, pageParam), getNextPageParam: (last, pages) => last.hasMore ? pages.length + 1 : undefined,
    enabled: search.length >= 2 && !manual && !selection, retry: false })
  const mutation = useMutation({ mutationFn: (draft: NutritionDraft) => nutrition.save(draft), onSuccess: async (entry) => {
    removeNutritionForm(userId, key)
    await cache.invalidateQueries({ queryKey: queryKey(userId) })
    if (active.current) onSaved(entry)
  } })
  const choose = (food: NutritionFood | NutritionEntry) => {
    form.setValue('selection', food)
    form.setValue('grams', 'grams' in food ? food.grams?.toString() ?? '' : food.servings?.[0]?.grams.toString() ?? suggestedGrams ?? '')
    setPortionMode(!('grams' in food) && (food.servings?.length ?? 0) > 0); setPortionCount('1')
    setSuggestedGrams(null)
    parsedSearch.current = null
    form.clearErrors()
  }
  const parsedFood = !manual && !selection ? parseFoodText(values.search ?? '') : []
  const searchParsedFood = (name: string, grams: number | null) => {
    parsedSearch.current = name
    form.setValue('search', name)
    setSuggestedGrams(grams === null ? null : String(grams))
  }
  const lookupBarcode = async (source = barcode) => {
    const code = source.replace(/\s|-/g, '')
    if (!/^\d{8}$|^\d{13}$/.test(code)) { setBarcodeError('Введите штрихкод из 8 или 13 цифр'); return }
    setBarcodePending(true); setBarcodeError(null)
    try {
      const food = await nutrition.barcode(code)
      if (food === null) { setBarcodeError('По этому штрихкоду продукт не найден. Можно добавить свою еду.'); return }
      choose(food)
    } catch { setBarcodeError('Не удалось проверить штрихкод. Повторите позже или добавьте свою еду.') } finally { setBarcodePending(false) }
  }
  const numeric = (field: 'calories' | 'protein' | 'fat' | 'carbs' | 'grams', required: boolean, max: number) => {
    const raw = form.getValues(field), value = nutritionDecimal(raw)
    if (!required && raw.trim() === '') return null
    if (value === null || value > max || (field === 'grams' && value <= 0)) {
      form.setError(field, { message: field === 'grams' ? 'Укажите вес больше 0 и не больше 20 000 г' : `Укажите число от 0 до ${max}` })
      return undefined
    }
    return value
  }
  const submit = (input: NutritionForm) => {
    if (mutation.isPending) return
    form.clearErrors()
    const basis = input.manual ? input.per100 ? '100g' : 'portion' : input.selection?.basis
    const serving = !input.manual && input.selection && !('grams' in input.selection) ? input.selection.servings?.[0] : undefined
    const portions = nutritionDecimal(portionCount)
    const grams = basis === '100g' ? portionMode && serving ? portions === null || portions <= 0 || portions > 100 ? undefined : serving.grams * portions : numeric('grams', true, 20000) : null
    if (portionMode && serving && grams === undefined) form.setError('grams', { message: 'Укажите от 0,1 до 100 порций' })
    let food: NutritionDraft['food'] | undefined
    if (input.manual) {
      const name = input.name.trim(), max = input.per100 ? 100 : 5000
      const calories = numeric('calories', true, input.per100 ? 1000 : 50000)
      const protein = numeric('protein', false, max), fat = numeric('fat', false, max), carbs = numeric('carbs', false, max)
      if (!name) form.setError('name', { message: 'Укажите название еды' })
      if (name && calories !== undefined && calories !== null && protein !== undefined && fat !== undefined && carbs !== undefined) {
        food = { kind: 'manual', name, basis: input.per100 ? '100g' : 'portion', calories, protein, fat, carbs }
      }
    } else if (input.selection) {
      // Recent/edit forms use the displayed immutable snapshot. A source entry
      // changed on another device must not silently replace these values.
      const selected = input.selection
      food = 'version' in selected ? { kind: 'manual', name: selected.name, basis: selected.basis,
        calories: selected.calories, protein: selected.protein, fat: selected.fat, carbs: selected.carbs }
        : { kind: 'catalog', id: selected.id }
    }
    if (food && grams !== undefined) mutation.mutate({ id: input.id, expectedVersion: input.expectedVersion,
      day: selectedDate(input.date, date), meal: input.meal, grams, food })
  }
  const previewValues = manual ? { calories: nutritionDecimal(values.calories ?? '') ?? 0,
    protein: nutritionDecimal(values.protein ?? ''), fat: nutritionDecimal(values.fat ?? ''), carbs: nutritionDecimal(values.carbs ?? '') } : form.getValues('selection')
  const basis = manual ? values.per100 ? '100g' : 'portion' : selection?.basis
  const preview = previewValues && basis ? scaledNutrition(previewValues, basis, nutritionDecimal(values.grams ?? '')) : null
  return <Page title={existing ? 'Редактировать запись' : 'Добавить еду'} back={-1} onBack={onBack} className="nutrition-page">
    <form className="stack" onSubmit={form.handleSubmit(submit)}>
      <fieldset className="stack nutrition-fields" disabled={mutation.isPending}>
      {!selection && !manual ? <>
        <Field label="Поиск еды"><input type="search" maxLength={120} autoFocus placeholder="Например, куриная грудка 300 г, рис отварной 100 г" {...form.register('search')} /></Field>
        {actor?.experiments?.nutritionBarcode === true && <VoiceInputButton
          source="nutrition"
          idleLabel="Надиктовать еду"
          showCancel
          onTranscript={(text) => {
            const previous = form.getValues('search')
            form.setValue('search', text)
            return () => form.setValue('search', previous)
          }}
        />}
        {actor?.experiments?.nutritionBarcode === true && <section className="nutrition-barcode" aria-label="Штрихкод продукта">
          <div className="nutrition-barcode-actions"><button type="button" className="secondary" disabled={barcodePending} onClick={() => { setBarcodeError(null); setScannerOpen(true) }}>Сканировать камерой</button>
            <BarcodePhotoPicker onDetected={(code) => { setBarcode(code); setManualBarcodeEntry(false); void lookupBarcode(code) }} onUnrecognized={() => { setManualBarcodeEntry(true); setBarcodeError('На фото не найден EAN‑8 или EAN‑13. Введите штрихкод вручную.') }} /></div>
          {manualBarcodeEntry && <><Field label="Штрихкод"><input inputMode="numeric" value={barcode} maxLength={13} placeholder="8 или 13 цифр" onChange={(event) => setBarcode(event.target.value)} /></Field>
            <button type="button" className="secondary" disabled={barcodePending} aria-busy={barcodePending} onClick={() => void lookupBarcode()}>{barcodePending ? 'Ищем…' : 'Найти по штрихкоду'}</button></>}
          {scannerOpen && <BarcodeScanner onClose={() => setScannerOpen(false)} onDetected={(code) => { setBarcode(code); setManualBarcodeEntry(false); setScannerOpen(false); void lookupBarcode(code) }} />}
          {barcodeError && <p className="muted" role="status">{barcodeError}</p>}
        </section>}
        {parsedFood.length > 1 && <section className="nutrition-parsed-food" aria-label="Разобранная еда"><p className="muted">Выберите продукт по очереди — вес уже подставится. КБЖУ не угадываем.</p>
          <div className="nutrition-food-list">{parsedFood.map((item, index) => <button type="button" className="secondary nutrition-food" key={`${item.name}.${index}`} onClick={() => searchParsedFood(item.name, item.grams)}>
            <span>{item.name}<small>{item.grams === null ? 'Вес не указан' : `${nutritionNumber(item.grams)} г`}</small></span><ChevronRightIcon />
          </button>)}</div>
        </section>}
        {search.length >= 2 ? <AsyncView loading={foods.isLoading} error={foods.error} onRetry={() => void foods.refetch()}>
          {foods.data?.pages.every((page) => page.foods.length === 0) && <p className="muted">Подходящей еды не нашлось. Можно добавить свою.</p>}
          <div className="nutrition-food-list">{foods.data?.pages.flatMap((page) => page.foods).map((food) => <div className="nutrition-food-result" key={food.id}><button type="button" className="secondary nutrition-food" onClick={() => choose(food)}><span>{food.name}{food.manufacturer && <small>{food.manufacturer}</small>}<small>{nutritionNumber(food.calories)} ккал · Б {nutritionNumber(food.protein)} · Ж {nutritionNumber(food.fat)} · У {nutritionNumber(food.carbs)} на 100 г</small></span><ChevronRightIcon /></button></div>)}</div>
          {foods.hasNextPage && <button type="button" className="secondary" disabled={foods.isFetchingNextPage} onClick={() => void foods.fetchNextPage()}>{foods.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}</button>}
        </AsyncView> : <><h2>Недавняя еда</h2><AsyncView loading={recent.isLoading} error={recent.error} onRetry={() => void recent.refetch()}>
          {!recent.data?.length && <p className="muted">Здесь появятся ваши записи для быстрого повторения.</p>}
          <div className="nutrition-food-list">{recent.data?.map((food) => <button type="button" className="secondary nutrition-food" key={food.id} onClick={() => choose(food)}><span>{food.name}<small>{food.grams ? `${nutritionNumber(food.grams)} г · ` : ''}{nutritionNumber(food.totals.calories)} ккал</small></span><ChevronRightIcon /></button>)}</div>
        </AsyncView></>}
        <button type="button" className="secondary" onClick={() => form.setValue('manual', true)}>Добавить свою еду</button>
      </> : <>
        {manual ? <><Field label="Название" error={form.formState.errors.name?.message}><input aria-label="Название" aria-invalid={!!form.formState.errors.name} maxLength={160} autoFocus {...form.register('name')} /></Field>
          <Switch label="На 100 г" checked={values.per100 ?? false} onChange={(value) => form.setValue('per100', value)} disabled={mutation.isPending} />
          <Field label={values.per100 ? 'Калории на 100 г' : 'Калории съеденной порции'} error={form.formState.errors.calories?.message}><input aria-label={values.per100 ? 'Калории на 100 г' : 'Калории съеденной порции'} aria-invalid={!!form.formState.errors.calories} inputMode="decimal" {...form.register('calories')} /></Field>
          <details><summary>Указать БЖУ (необязательно)</summary><div className="nutrition-macros-form">{(['protein', 'fat', 'carbs'] as const).map((field, index) => <Field key={field} label={['Белки, г', 'Жиры, г', 'Углеводы, г'][index]!} error={form.formState.errors[field]?.message}><input aria-label={['Белки, г', 'Жиры, г', 'Углеводы, г'][index]!} aria-invalid={!!form.formState.errors[field]} inputMode="decimal" {...form.register(field)} /></Field>)}</div></details>
        </> : <h2>{selection?.name}</h2>}
        {basis === '100g' && <>{selectedServing && selectedServingGrams !== null ? <div className="nutrition-quantity-mode"><button type="button" className={portionMode ? 'secondary' : 'primary'} onClick={() => setPortionMode(false)}>Граммы</button><button type="button" className={portionMode ? 'primary' : 'secondary'} onClick={() => setPortionMode(true)}>Порции</button></div> : null}{portionMode && selectedServing && selectedServingGrams !== null ? <Field label={`${selectedServing.label}, ${nutritionNumber(selectedServingGrams)} г`} error={form.formState.errors.grams?.message}><input aria-label="Сколько порций" inputMode="decimal" value={portionCount} onChange={event => setPortionCount(event.target.value)} /></Field> : <Field label="Сколько съели, г" error={form.formState.errors.grams?.message}><input aria-label="Сколько съели, г" aria-invalid={!!form.formState.errors.grams} inputMode="decimal" autoFocus={!manual} {...form.register('grams')} /></Field>}</>}
        {preview && <Totals values={preview} />}
        <div className="nutrition-date-meal"><Field label="Дата"><input type="date" min="1900-01-01" max="2100-12-31" {...form.register('date', { required: true })} /></Field>
          <Field label="Приём пищи"><span className="nutrition-native-select"><select {...form.register('meal')}>{Object.entries(NUTRITION_MEALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronRightIcon /></span></Field></div>
        <p className="muted">КБЖУ — справочные значения. Рецепт и размер порции могут отличаться.</p>
        <SaveStatus status={mutation.isPending ? 'saving' : mutation.isError ? 'error' : 'idle'} error={mutation.error?.message} />
        {isRepositoryConflict(mutation.error) && <button type="button" className="secondary" onClick={async () => {
          if (!await confirm({ message: 'Запись уже изменили на другом устройстве. Вернуться к актуальному дневнику? Несохранённые изменения этой формы будут удалены.', confirmLabel: 'Вернуться к дневнику' })) return
          removeNutritionForm(userId, key)
          await cache.invalidateQueries({ queryKey: queryKey(userId) })
          if (active.current) onBack()
        }}>Открыть актуальный дневник</button>}
        <button type="submit" className="primary" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
        {existing && !manual && <button type="button" className="link" disabled={mutation.isPending} onClick={() => {
          form.setValue('manual', true); form.setValue('per100', existing.basis === '100g')
          form.setValue('name', existing.name); form.setValue('calories', String(existing.calories))
          form.setValue('protein', existing.protein === null ? '' : String(existing.protein))
          form.setValue('fat', existing.fat === null ? '' : String(existing.fat))
          form.setValue('carbs', existing.carbs === null ? '' : String(existing.carbs))
        }}>Изменить название и КБЖУ</button>}
        {!existing && <button type="button" className="link" disabled={mutation.isPending} onClick={() => { form.setValue('selection', null); form.setValue('manual', false) }}>Выбрать другую еду</button>}
      </>}
      {storageError && <p className="muted" role="status">Черновик доступен только на этом экране. Не закрывайте его до сохранения.</p>}
      </fieldset>
    </form>
    {dialog}
  </Page>
}

export function NutritionPage() {
  const { actor } = useAuth(), { nutrition, clients } = useDataBackend(), { clientId } = useParams()
  const [params] = useSearchParams(), navigate = useNavigate(), cache = useQueryClient()
  const today = todayInTimeZone(actor?.timezone), date = selectedDate(params.get('date'), today)
  const path = clientId ? `/clients/${clientId}/nutrition` : '/me/nutrition', day = useNutritionDay(date, clientId)
  const client = useQuery({ queryKey: ['client', clientId], queryFn: () => clients.get(clientId!),
    enabled: !!clientId && !!actor && isNutritionPilotEnabled(actor.userId, actor.experiments?.nutrition), retry: false })
  const [deleted, setDeleted] = useState<NutritionEntry | null>(null), [confirm, dialog] = useConfirm()
  const mutation = useMutation({ mutationFn: ({ entry, remove }: { entry: NutritionEntry; remove: boolean }) => nutrition.setDeleted(entry.id, entry.version, remove),
    onSuccess: async (entry) => { setDeleted(entry.deletedAt ? entry : null); await cache.invalidateQueries({ queryKey: queryKey(actor?.userId ?? '') }) } })
  if (!actor || !isNutritionPilotEnabled(actor.userId, actor.experiments?.nutrition)) return <Navigate to={actor?.role === 'trainer' ? '/clients' : '/me'} replace />
  const editingId = params.get('edit'), editing = day.data?.entries.find((entry) => entry.id === editingId)
  if (!clientId && (params.get('action') === 'add' || editing)) return <FoodForm key={editingId ?? 'new'} userId={actor.userId} date={date} existing={editing}
    onBack={() => navigate(`${path}?date=${date}`)} onSaved={(entry) => navigate(`${path}?date=${entry.day}&saved=${entry.id}`, { replace: true })} />
  const changeDate = (next: string) => navigate(`${path}?date=${selectedDate(next, today)}`)
  return <Page title="Дневник питания" subtitle={clientId ? `${client.data?.fullName ?? 'Клиент'} · Только просмотр` : undefined} back={clientId ? `/clients/${clientId}` : '/me'} className="nutrition-page">
    <div className="nutrition-date-nav"><button type="button" className="secondary" aria-label="Предыдущий день" onClick={() => changeDate(addDays(date, -1))}><BackIcon /></button>
      <Field label="Дата дневника"><input type="date" min="1900-01-01" max="2100-12-31" value={date} onChange={(event) => changeDate(event.target.value)} /></Field>
      <button type="button" className="secondary" aria-label="Следующий день" onClick={() => changeDate(addDays(date, 1))}><ChevronRightIcon /></button></div>
    {params.get('saved') && <p role="status">Запись сохранена</p>}
    <AsyncView loading={day.isLoading} error={day.error} onRetry={() => void day.refetch()}>
      {day.data?.access === 'locked' ? <p className="card muted">Клиент пока не разрешил просмотр дневника. Разрешение он может включить у себя в разделе «Кто видит мой дневник».</p> : day.data?.access === 'granted' && <>
        <section className="card nutrition-day-summary"><h2>Записано за {formatLocalDate(date)}</h2><Totals values={day.data.totals} /></section>
        {day.data.entries.length === 0 && <p className="muted">В этот день записей нет.{!clientId && ' Добавьте первую еду.'}</p>}
        {Object.entries(NUTRITION_MEALS).map(([meal, label]) => {
          const entries = day.data?.entries.filter((entry) => entry.meal === meal) ?? []
          return entries.length > 0 && <section key={meal} className="nutrition-meal"><h2>{label}</h2>{entries.map((entry) => <div className={`nutrition-entry${params.get('saved') === entry.id ? ' nutrition-entry-saved' : ''}`} key={entry.id}>
            {clientId ? <div><strong>{entry.name}</strong><small>{entry.grams === null ? 'Порция' : `${nutritionNumber(entry.grams)} г`}</small><Totals values={entry.totals} />
              <details><summary>Подробности записи</summary><p className="muted">{entry.basis === '100g' ? 'Справочные КБЖУ на 100 г' : 'КБЖУ указанной порции'}</p><Totals values={entry} />
                <small className="muted">КБЖУ — справочные значения. Рецепт и размер порции могут отличаться.</small></details></div>
              : <Link to={`${path}?date=${date}&edit=${entry.id}`} aria-label={`Редактировать: ${entry.name}`}><strong>{entry.name}</strong><small>{entry.grams === null ? 'Порция' : `${nutritionNumber(entry.grams)} г`}</small><Totals values={entry.totals} /></Link>}
            {!clientId && <OverflowMenu label={`Действия: ${entry.name}`} items={[{ label: 'Удалить запись', danger: true, onClick: async () => {
              if (!mutation.isPending && await confirm({ message: `Удалить запись «${entry.name}»? Её можно будет вернуть.`, confirmLabel: 'Удалить', danger: true })) mutation.mutate({ entry, remove: true })
            } }]} />}
          </div>)}</section>
        })}
      </>}
    </AsyncView>
    <SaveStatus status={mutation.isPending ? 'saving' : mutation.isError ? 'error' : 'idle'} error={mutation.error?.message} />
    {deleted && <div role="status" className="nutrition-undo">Запись удалена<button type="button" className="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate({ entry: deleted, remove: false })}>Вернуть</button></div>}
    {!clientId && <><Link className="button" to={`${path}?date=${date}&action=add`}>Добавить еду</Link><ConsentSettings userId={actor.userId} /></>}
    {clientId && <ChatStartButton clientId={clientId} trainerId={actor.userId} className="secondary" />}
    {dialog}
  </Page>
}
