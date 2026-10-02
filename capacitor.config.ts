import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.coachspace.fit',
  appName: 'Fit',
  webDir: 'dist',
  backgroundColor: '#15131a',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
}

export default config
