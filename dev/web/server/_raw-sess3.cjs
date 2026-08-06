const Database = require('better-sqlite3')
const db = new Database('C:\\.Tianshu\\sessions.db', { readonly: true })

const sid = 'msgtzqljcrqqki'

const session = db.prepare('SELECT id, title, character_id, current_strategy, workspace, session_type, event_id, updated_at, created_at FROM sessions WHERE id = ?').get(sid)
console.log('=== SESSION ===')
console.log(JSON.stringify(session, null, 2))

console.log('\n=== RUNS ===')
const runs = db.prepare(`SELECT id, turn_id, parent_run_id, resumed_from_run_id, status, phase, execution_mode, turn_no, max_turns, queued_at, started_at, finished_at, updated_at FROM runs WHERE session_id = ? ORDER BY queued_at`).all(sid)
for (const r of runs) {
  console.log(JSON.stringify({
    ...r,
    queued_at: r.queued_at ? new Date(r.queued_at).toLocaleString() : null,
    started_at: r.started_at ? new Date(r.started_at).toLocaleString() : null,
    finished_at: r.finished_at ? new Date(r.finished_at).toLocaleString() : null,
    updated_at: new Date(r.updated_at).toLocaleString(),
  }))
}

console.log('\n=== CHECKPOINTS ===')
const cps = db.prepare('SELECT * FROM checkpoints WHERE run_id IN (SELECT id FROM runs WHERE session_id = ?) ORDER BY created_at').all(sid)
for (const c of cps) console.log(JSON.stringify({ id: c.id, run_id: c.run_id, reason: c.reason, created_at: new Date(c.created_at).toLocaleString(), pending_request: c.pending_request }))

console.log('\n=== RUN EVENTS (count + last 25) ===')
const evCount = db.prepare('SELECT COUNT(*) c FROM run_events WHERE session_id = ?').get(sid).c
console.log('total events:', evCount)
const events = db.prepare('SELECT event_id, run_id, seq, type, payload, created_at FROM run_events WHERE session_id = ? ORDER BY seq').all(sid)
for (const e of events.slice(-25)) {
  const p = e.payload && e.payload.length > 120 ? e.payload.slice(0, 120) + '…' : e.payload
  console.log(JSON.stringify({ seq: e.seq, type: e.type, run: e.run_id.slice(-8), created_at: new Date(e.created_at).toLocaleTimeString(), payload: p }))
}

console.log('\n=== MESSAGES ===')
const msgs = db.prepare('SELECT id, role, content, tool_name, tool_status, created_at FROM messages WHERE session_id = ? ORDER BY id').all(sid)
console.log('total:', msgs.length)
for (const m of msgs) {
  let c = (m.content || '').replace(/\n+/g, ' ').slice(0, 90)
  console.log(JSON.stringify({ id: m.id, role: m.role, tool: m.tool_name, status: m.tool_status, t: new Date(m.created_at).toLocaleTimeString(), content: c }))
}

db.close()
