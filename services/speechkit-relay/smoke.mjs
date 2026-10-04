import WebSocket from 'ws'

const url = process.argv[2]
if (!url) throw new Error('Usage: node smoke.mjs <wss-url>')

await new Promise((resolve, reject) => {
  const socket = new WebSocket(url)
  let ready = false
  let flushed = false
  const timeout = setTimeout(() => {
    socket.terminate()
    reject(new Error('SpeechKit relay smoke timed out'))
  }, 12_000)

  const fail = (error) => {
    clearTimeout(timeout)
    socket.terminate()
    reject(error instanceof Error ? error : new Error(String(error)))
  }

  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'config' }))
    socket.send(Buffer.alloc(32_000))
    ready = true
    setTimeout(() => socket.send(JSON.stringify({ type: 'stop' })), 3_000)
  })
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(String(raw))
      if (message.type === 'error') fail(new Error(`SpeechKit relay returned an error: ${message.message || 'unknown'}`))
      if (message.type === 'done') {
        flushed = true
        socket.close(1000)
      }
    } catch (error) {
      fail(error)
    }
  })
  socket.on('error', fail)
  socket.on('close', (code) => {
    clearTimeout(timeout)
    if (!ready) reject(new Error(`SpeechKit relay closed before opening (${code})`))
    else if (code !== 1000) reject(new Error(`SpeechKit relay closed unexpectedly (${code})`))
    else if (!flushed) reject(new Error('SpeechKit relay closed before final flush acknowledgement'))
    else resolve()
  })
})

console.log(`SpeechKit relay WebSocket is healthy: ${url}`)
