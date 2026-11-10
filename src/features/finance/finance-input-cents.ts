export function financeInputCents(value: FormDataEntryValue | null): number {
  const normalized = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.')
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000 || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Проверьте сумму')
  return Math.round(amount * 100)
}

