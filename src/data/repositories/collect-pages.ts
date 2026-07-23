export interface Page<T> {
  items: T[]
  nextOffset?: number
}

export function pageFromLookahead<T>(rows: T[], pageSize: number, offset: number): Page<T> {
  const hasMore = rows.length > pageSize
  return {
    items: rows.slice(0, pageSize),
    nextOffset: hasMore ? offset + pageSize : undefined,
  }
}

export async function collectPages<T>(loadPage: (offset: number) => Promise<Page<T>>): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    const page = await loadPage(offset)
    rows.push(...page.items)
    if (page.nextOffset === undefined) return rows
    offset = page.nextOffset
  }
}
