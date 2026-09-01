function copyWithSelection(text: string): boolean {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')
  field.style.position = 'fixed'
  field.style.inset = '0 auto auto -9999px'
  field.style.fontSize = '16px'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.focus()
  field.select()
  field.setSelectionRange(0, field.value.length)

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    activeElement?.focus()
  }
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // В iOS WebView Clipboard API может быть объявлен, но отклонять запись.
      // В таком случае используем совместимый способ через выделение текста.
    }
  }

  if (copyWithSelection(text)) return
  throw new Error('clipboard_unavailable')
}
