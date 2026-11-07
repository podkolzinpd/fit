import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/auth-context'
import { CorporatePersonalError, corporatePersonalRepository as repository, type EmployeeCommand, type EmployeeMark } from '../../data/repositories/corporate-personal.repository'
import { AsyncView, Switch } from '../../shared/ui'
import { formatLocalDateShort, localDate } from '../../shared/local-date'
import './personal.css'

export function CorporateEmployeeMark({ clientId }: {clientId:string}) {
  const { actor } = useAuth()
  const access = useQuery({queryKey:['corporate-personal-access',actor?.userId],queryFn:()=>repository.access(),
    enabled:actor?.role === 'trainer',staleTime:0,retry:false})
  if (actor?.role !== 'trainer') return null
  if (access.error) return <p className="error" role="alert">Не удалось проверить доступ к учёту Яндекса. <button type="button" className="secondary" onClick={()=>void access.refetch()}>Повторить проверку</button></p>
  if (access.data !== true) return null
  return <EmployeeMarkEditor key={`${actor.userId}:${clientId}`} clientId={clientId} actorId={actor.userId} />
}
function EmployeeMarkEditor({clientId,actorId}:{clientId:string;actorId:string}) {
  const cache = useQueryClient(), key = ['corporate-employee-mark',actorId,clientId]
  const pending = useRef<EmployeeCommand|null>(null)
  const [hasPending, setHasPending] = useState(false)
  const query = useQuery({queryKey:key,queryFn:()=>repository.mark(clientId),staleTime:0,retry:false})
  const save = useMutation({mutationFn:(command:EmployeeCommand)=>repository.save(clientId,command),retry:false,
    onSuccess:async value=>{
      await cache.cancelQueries({queryKey:key,exact:true})
      const current=cache.getQueryData<EmployeeMark>(key)
      if (current && current.version>value.version) throw new CorporatePersonalError(409,'Отметка уже изменилась. Загрузите сохранённую версию.')
      pending.current=null;setHasPending(false);cache.setQueryData(key,value)
    }})
  const change = (marked:boolean) => {
    if (!query.data || pending.current) return
    const command = {marked,version:query.data.version,commandId:crypto.randomUUID()}
    pending.current=command;setHasPending(true);save.mutate(command)
  }
  const reload = async() => {
    const result = await query.refetch()
    if (result.isSuccess) {pending.current=null;setHasPending(false);save.reset()}
  }
  const conflict = save.error instanceof CorporatePersonalError && save.error.status === 409
  const forbidden = save.error instanceof CorporatePersonalError && [401,403,404].includes(save.error.status)
  return <section className="corporate-employee-mark ym-hide-content" aria-label="Учёт Яндекса">
    <AsyncView loading={query.isPending} error={query.error} onRetry={()=>void query.refetch()}>
      {query.data && <>
        <Switch label="Сотрудник Яндекса" checked={query.data.marked} disabled={save.isPending || hasPending} onChange={change}/>
        <p className="corporate-personal-note">{query.data.marked && query.data.fromDate
          ? `Учитываем проведённые тренировки с тренером с ${formatLocalDateShort(localDate(query.data.fromDate))}. Самостоятельные не учитываются.`
          : 'Отметьте сотрудника для учёта проведённых тренировок с тренером. Старые занятия не добавятся.'}</p>
      </>}
    </AsyncView>
    {save.isPending && <p role="status">Сохраняем отметку…</p>}
    {save.error && <div role="alert"><p className="error">{save.error.message}</p><div className="actions">
      {!conflict && !forbidden && hasPending && <button className="secondary" type="button" onClick={()=>pending.current && save.mutate(pending.current)}>Повторить сохранение</button>}
      <button className="secondary" type="button" disabled={query.isFetching} onClick={()=>void reload()}>Загрузить сохранённую версию</button>
    </div></div>}
    {save.isSuccess && <p role="status">Отметка сохранена</p>}
  </section>
}
