const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const turns = j.turns;

const files = {};
function track(path, op) {
  if (!path || typeof path !== 'string') return;
  files[path] = files[path] || { read: 0, write: 0, edit: 0, bash: 0, other: 0 };
  files[path][op]++;
}
function parseArgs(c) {
  const raw = c.function && c.function.arguments;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return { _raw: raw }; } }
  return c.args || {};
}

const bashCmds = [];
for (let ti = 0; ti < turns.length; ti++) {
  const resp = turns[ti].response || {};
  const tc = resp.toolCalls;
  if (!Array.isArray(tc)) continue;
  for (const c of tc) {
    const name = c.function && c.function.name;
    const a = parseArgs(c);
    switch (name) {
      case 'read': track(a.file_path || a.path, 'read'); break;
      case 'write': track(a.file_path || a.path, 'write'); break;
      case 'edit': track(a.file_path || a.path, 'edit'); break;
      case 'bash': {
        const cmd = a.command || a._raw || '';
        bashCmds.push({ turn: ti, cmd: cmd.slice(0, 300) });
        const m = cmd.match(/([A-Za-z]:[\\\/][^"'\s]+|\.{1,2}[\\\/][^"'\s]+)/g);
        if (m) for (const p of m) track(p, 'bash');
        break;
      }
    }
  }
}

console.log('=== FILES (write/edit/read counts) ===');
const sorted = Object.entries(files).sort((x, y) => (y[1].write + y[1].edit) - (x[1].write + x[1].edit));
for (const [p, o] of sorted) {
  if (o.write + o.edit + o.read > 0) console.log(`${o.write}W ${o.edit}E ${o.read}R  ${p}`);
}

console.log('\n=== WRITTEN/EDITED FILES ONLY ===');
for (const [p, o] of sorted) if (o.write + o.edit > 0) console.log(`${o.write}W ${o.edit}E  ${p}`);

console.log('\n=== BASH COMMANDS (unique-ish, first 90) ===');
bashCmds.slice(0, 90).forEach(b => console.log(`[t${b.turn}] ${b.cmd}`));

// final turns detail
console.log('\n=== LAST 5 TURNS (full) ===');
for (let ti = Math.max(0, turns.length - 5); ti < turns.length; ti++) {
  const t = turns[ti];
  const r = t.response || {};
  console.log(`\n----- TURN ${ti} (timestamp ${t.timestamp}) -----`);
  console.log('text:', (r.text || '').slice(0, 1500));
  if (r.reasoning) console.log('reasoning:', String(r.reasoning).slice(0, 1200));
  if (Array.isArray(r.toolCalls)) {
    for (const c of r.toolCalls) {
      const a = parseArgs(c);
      console.log(`  TOOL ${c.function && c.function.name}: ${JSON.stringify(a).slice(0, 300)}`);
    }
  }
}
