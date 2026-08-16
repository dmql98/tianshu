// Fake packaged server: announces readiness, then sends an approval request
// over the same parent-process IPC channel used by the real server.
process.send({ type: 'ready', port: 41119 })
setTimeout(() => {
  process.send({
    type: 'approval-required',
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: 'tool-call-1',
    sessionTitle: 'Background task',
    toolName: 'shell_command',
    approvalKind: 'risk',
  })
}, 50)
setTimeout(() => {
  process.send({
    type: 'approval-cleared',
    sessionId: 'session-1',
    toolCallId: 'tool-call-1',
  })
}, 100)
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') process.exit(0)
})
