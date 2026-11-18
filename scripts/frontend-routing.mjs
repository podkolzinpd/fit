// Static frontend contract shared by release packaging and hosting adapters.
export const supportedRouting = [
  { handle: 'filesystem' },
  { src: '/assets/.*\\.js', dest: '/asset-recovery.js' },
  { src: '/assets/.*', status: 404 },
  { src: '/(.*)', dest: '/index.html' },
]
