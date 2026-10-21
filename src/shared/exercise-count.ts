export function exerciseCountText(count: number): string {
  const lastTwo = count % 100
  const last = count % 10
  const word = lastTwo >= 11 && lastTwo <= 14 ? 'упражнений'
    : last === 1 ? 'упражнение' : last >= 2 && last <= 4 ? 'упражнения' : 'упражнений'
  return `${count} ${word}`
}
