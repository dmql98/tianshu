// Fake server: sends { type: 'ready' } then exits cleanly on shutdown.
process.send({ type: 'ready', port: 41117 })
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') process.exit(0)
})
