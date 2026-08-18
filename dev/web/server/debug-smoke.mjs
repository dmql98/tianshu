import { createServer } from "node:http"
process.env.TIANSHU_DATA_DIR = 'C:/Users/dmql/Desktop/tianshu/TianShu/dev/devdata'
const { default: debugRouter } = await import('./src/routes/debug.ts')
const { Hono } = await import('hono')
const app = new Hono().route('/api/debug', debugRouter)
const server = createServer(app.fetch)
await new Promise(r => server.listen(0, r))
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const r1 = await fetch(`${base}/api/debug/sessions`)
const sessions = await r1.json()
console.log('sessions count:', sessions.length)
console.log('first session:', JSON.stringify(sessions[0]).slice(0, 300))
const sid = sessions[0]?.session_id
if (sid) {
  const r2 = await fetch(`${base}/api/debug/sessions/${sid}`)
  const detail = await r2.json()
  console.log('files:', detail.files.map(f => `${f.file}(${f.turns.length} turns)`).join(', '))
  const firstTurn = detail.files[0]?.turns?.[0]
  if (firstTurn) {
    const r3 = await fetch(`${base}/api/debug/sessions/${sid}/turns/${firstTurn.turn}`)
    const turn = await r3.json()
    console.log('turn keys:', Object.keys(turn).join(','))
    console.log('request.model:', turn.request?.model)
    console.log('request.messages:', turn.request?.messages?.length, 'tools:', turn.request?.tools?.length)
    console.log('response.text len:', turn.response?.text?.length, 'toolCalls:', turn.response?.toolCalls?.length)
  }
}
const r404 = await fetch(`${base}/api/debug/sessions/__nope__`)
console.log('404 status:', r404.status)
server.close()
