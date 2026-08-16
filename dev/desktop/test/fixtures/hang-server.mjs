// Fake server: becomes ready, then ignores the shutdown IPC so the manager
// must fall back to the kill-process-tree strategy.
process.send({ type: 'ready', port: 41117 })
process.on('message', () => {
  /* deliberately ignore shutdown */
})
