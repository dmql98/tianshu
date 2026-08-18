const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
const records = lines.map(l => JSON.parse(l));

const toolStats = {};
const files = {};
const userMsgs = [];
const todos = [];
const goals = [];
const finalMsgs = [];
const retries = [];

function track(path, op) {
  if (!path || typeof path !== 'string' || !/^[A-Za-z]:[\\\/]/.test(path)) return;
  files[path] = files[path] || { read: 0, write: 0, edit: 0, bash: 0, other: 0 };
  files[path][op]++;
}
function parseArgs(s) {
  if (typeof s === 'string') { try { return JSON.parse(s); } catch { return { _raw: s }; } }
  return s || {};
}

for (const r of records) {
  switch (r.type) {
    case 'tool/call': {
      const d = r.data;
      toolStats[d.name] = (toolStats[d.name] || 0) + 1;
      const a = parseArgs(d.arguments);
      switch (d.name) {
        case 'read': track(a.file_path, 'read'); break;
        case 'write': track(a.file_path, 'write'); break;
        case 'edit': track(a.file_path, 'edit'); break;
        case 'pwsh': case 'bash': {
          const cmd = a.command || '';
          const m = cmd.match(/([A-Za-z]:[\\\/][^"'\s]+)/g);
          if (m) for (const p of m) track(p, 'bash');
          break;
        }
        default: for (const k of ['path', 'file_path', 'pattern']) if (a[k]) track(a[k], 'other');
      }
      break;
    }
    case 'user/message': {
      const txt = (r.data.content || []).map(c => c.text || '').join(' ');
      userMsgs.push({ seq: r.seq, time: r.time, text: txt });
      break;
    }
    case 'todo/write': todos.push({ seq: r.seq, time: r.time, todos: r.data.todos }); break;
    case 'goal/change': goals.push({ seq: r.seq, operation: r.data.operation, objective: r.data.goal && r.data.goal.objective }); break;
    case 'assistant/message': {
      const m = r.data.message;
      const text = (m.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ');
      if (text.trim()) finalMsgs.push({ seq: r.seq, turn: r.data.turn, step: r.data.step, text });
      break;
    }
    case 'llm/retry': retries.push({ seq: r.seq, turn: r.data.turn, step: r.data.step, retry: r.data.retry, code: r.data.failure && r.data.failure.code, msg: r.data.failure && r.data.failure.message }); break;
  }
}

console.log('=== TOOL USAGE ===');
for (const [k, v] of Object.entries(toolStats).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);

console.log('\n=== FILES WRITTEN/EDITED (sorted by writes+edits) ===');
const sorted = Object.entries(files).sort((x, y) => (y[1].write + y[1].edit) - (x[1].write + x[1].edit));
for (const [p, o] of sorted) if (o.write + o.edit > 0) console.log(`${o.write}W ${o.edit}E ${o.read}R  ${p}`);
console.log('--- files only read (sample, first 30) ---');
for (const [p, o] of sorted.filter(([, o]) => o.read > 0 && o.write + o.edit === 0).slice(0, 30)) console.log(`R ${p}`);

console.log('\n=== USER MESSAGES ===');
userMsgs.forEach(m => console.log(`[seq ${m.seq}] ${m.text.slice(0, 800)}`));

console.log('\n=== TODO EVOLUTION ===');
todos.forEach((t, i) => {
  console.log(`\n--- todo/write #${i} (seq ${t.seq}) ---`);
  t.todos.forEach(td => console.log(`  [${td.status}] ${td.content.slice(0, 140)}`));
});

console.log('\n=== GOAL CHANGES ===');
goals.forEach(g => console.log(`[seq ${g.seq}] ${g.operation}: ${(g.objective || '').slice(0, 300)}`));

console.log('\n=== RETRIES ===');
retries.forEach(r => console.log(`[seq ${r.seq}] turn ${r.turn} step ${r.step} retry ${r.retry} code=${r.code} msg=${r.msg}`));

console.log('\n=== FINAL ASSISTANT TEXT (last 4) ===');
finalMsgs.slice(-4).forEach(m => console.log(`\n--- seq ${m.seq} turn ${m.turn} step ${m.step} (${m.text.length} chars) ---\n${m.text.slice(0, 2500)}`));
