export function androidOtaPolicy(root?: string, env?: NodeJS.ProcessEnv): {
  enabled: boolean; abi: string; publicKey: string; appId: string; origin: string; channel: string
}
