import { androidOtaPolicy } from './scripts/android-ota-contract.mjs'
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.coachspace.fit',
  appName: 'Fit',
  webDir: 'dist',
  plugins: { LiveUpdate: {
    publicKey: androidOtaPolicy().publicKey, readyTimeout: 20000,
    autoBlockRolledBackBundles: true, autoDeleteBundles: true, autoUpdateStrategy: 'none',
    httpTimeout: 30000,
  } },
  backgroundColor: '#15131a',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
}

export default config
