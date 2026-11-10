import { useState } from 'react'
import { Field } from '../../shared/ui'
import { localDate } from '../../shared/local-date'
import { financeInputCents } from './finance-input-cents'
import './single-session-fields.css'

export interface SingleServiceDraft {priceCents:number;paidCents:number;receivedOn:string}
export function readSingleServiceFields(form:HTMLFormElement,today:string,initial?:SingleServiceDraft):SingleServiceDraft {
  const data=new FormData(form),priceCents=financeInputCents(data.get('singlePrice')),paidCents=financeInputCents(data.get('singlePaid'))
  if(paidCents>priceCents)throw new Error('Оплата не может быть больше стоимости')
  return {priceCents,paidCents,receivedOn:localDate(String(data.get('singleReceivedOn')??initial?.receivedOn??today))}
}
export function SingleSessionFields({today,disabled,initial}:{today:string;disabled:boolean;initial?:SingleServiceDraft}){
  const [paid,setPaid]=useState(String((initial?.paidCents??0)/100))
  return <fieldset className="single-session-fields" disabled={disabled}><legend className="sr-only">Стоимость и оплата</legend>
    <Field label="Стоимость, ₽"><input name="singlePrice" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" required defaultValue={initial?String(initial.priceCents/100):''}/></Field>
    <Field label="Получено, ₽"><input name="singlePaid" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" required value={paid} onChange={event=>setPaid(event.target.value)}/></Field>
    {Number(paid)>0&&<Field label="Дата получения"><input name="singleReceivedOn" type="date" required defaultValue={initial?.receivedOn??today}/></Field>}
  </fieldset>
}
