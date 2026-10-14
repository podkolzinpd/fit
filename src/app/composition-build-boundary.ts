export function isLocalLegacyBuild(mode: string): boolean {
  return mode === 'development' || mode === 'test'
}

export function assertNativeFrontendModules(moduleIds: Iterable<string>): void {
  for (const id of moduleIds) {
    const path = id.replaceAll('\\', '/')
    if (path.includes('/node_modules/@supabase/')
      || /\/src\/data\/queries\/client\.ts(?:\?|$)/.test(path)
      || /\/src\/app\/local-legacy-composition\.ts(?:\?|$)/.test(path)) {
      throw new Error(`Native frontend contains a local legacy dependency: ${path}`)
    }
  }
}
