const Database = require('better-sqlite3')
const { join } = require('path')
const db = new Database(join(__dirname, 'data/sessions.db'))
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
console.log('Tables:', tables.map(t => t.name).join(', '))
for (const t of tables) {
  const cols = db.prepare('PRAGMA table_info(' + t.name + ')').all()
  console.log(t.name + ':', cols.map(c => c.name + ' ' + c.type).join(', '))
}
console.log('=== Session mr4k984187gr5z ===')
const sessionId = process.argv[2] || 'mr4k984187gr5z'
const rows = db.prepare("SELECT id, role, tool_name, tool_input, tool_status FROM messages WHERE session_id = ? ORDER BY id").all(sessionId)
console.log('Messages:', rows.length)
for (const r of rows) {
  const inp = typeof r.tool_input === 'string' ? r.tool_input.substring(0,600) : JSON.stringify(r.tool_input)
  console.log(JSON.stringify({ id: r.id, role: r.role, tool: r.tool_name, input: inp, status: r.tool_status }))
}
db.close()
