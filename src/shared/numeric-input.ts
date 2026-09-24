// Ноль в весе/повторах обычно является стартовой заглушкой. Числовые поля
// нельзя надёжно выделить целиком в Safari, поэтому при фокусе временно
// очищаем ноль. Если пользователь ничего не ввёл, возвращаем его при blur.
export function prepareZeroReplacement(input: HTMLInputElement): void {
  if (input.value === '' || Number(input.value) !== 0) return

  input.value = ''

  const cleanup = () => {
    input.removeEventListener('input', handleInput)
    input.removeEventListener('blur', handleBlur)
  }
  const handleInput = () => cleanup()
  const handleBlur = () => {
    if (input.value === '') input.value = '0'
    cleanup()
  }

  input.addEventListener('input', handleInput, { once: true })
  input.addEventListener('blur', handleBlur, { once: true })
}
