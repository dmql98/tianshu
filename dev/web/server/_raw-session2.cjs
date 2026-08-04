const Database = require('better-sqlite3')
const db = new Database('C:/.Tianshu/sessions.db', { readonly: true })
const sid = 'ms91vpzptt1hcb'
console.log('=== runs ===')
for (const r of db.prepare('SELECT id,status,phase,queued_at,started_at,finished_at,resumed_from_run_id FROM runs WHERE session_id=? ORDER BY queued_at').all(sid)) {
  const f = (t) => t ? new Date(t).toLocaleTimeString('zh-CN') : null
  console.log(JSON.stringify({ ...r, queued: f(r.queued_at), started: f(r.started_at), finished: f(r.finished_at) }))
}
console.log('=== checkpoints ===')
for (const c of db.prepare('SELECT id,run_id,reason,substr(pending_request,1,120) pending,created_at FROM checkpoints ORDER BY created_at').all()) {
  console.log(JSON.stringify({ ...c, at: new Date(c.created_at).toLocaleTimeString('zh-CN') }))
}
console.log('=== events (non-delta) ===')
const rows = db.prepare("SELECT run_id,type,created_at,substr(payload,1,120) p FROM run_events WHERE session_id=? AND type NOT IN ('message.delta','tool.output') ORDER BY created_at").all(sid)
for (const e of rows) {
  console.log(JSON.stringify({ t: new Date(e.created_at).toLocaleTimeString('zh-CN'), run: String(e.run_id).slice(-8), type: e.type, p: e.p }))
}
console.log('=== messages ===')
for (const m of db.prepare('SELECT id,role,substr(content,1,150) content,tool_name,tool_status,created_at FROM messages WHERE session_id=? ORDER BY id').all(sid)) {
  console.log(JSON.stringify({ id: m.id, role: m.role, content: m.content, tool_name: m.tool_name, tool_status: m.tool_status }))
}
