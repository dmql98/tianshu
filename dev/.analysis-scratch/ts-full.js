const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const turns = j.turns;

const files = {}; // path -> {read, write, edit, bash, other}
const planSteps = [];
const finalTexts = [];

function parseArgs(c) {
  const raw = c.function && c.function.arguments;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return { _raw: raw }; } }
  return c.args || {};
}

function track(path, op) {
  if (!path || typeof path !== 'string') return;
  files[path] = files[path] || { read: 0, write: 0, edit: 0, bash: 0, other: 0 };
  files[path][op]++;
}

for (let ti = 0; ti < turns.length; ti++) {
  const t = turns[ti];
  const resp = t.response || {};
  const tc = resp.toolCalls;
  if (Array.isArray(tc)) {
    for (const c of tc) {
      const name = c.function && c.function.name;
      const a = parseArgs(c);
      switch (name) {
        case 'read': track(a.file_path, 'read'); break;
        case 'write': track(a.file_path, 'write'); break;
        case 'edit': track(a.file_path, 'edit'); break;
        case 'bash': {
          const cmd = a.command || a._raw || '';
          const m = cmd.match(/["']?([A-Za-z]:[^"'\\s]+|\.{1,2}\/[^"'\\s]+)["']?/g);
          if (m) for (const p of m) track(p.replace(/["']/g, ''), 'bash');
          // also track git files
          if (/git\s+add/.test(cmd)) {
            const mm = cmd.match(/git add ([^\n]+)/);
            if (mm) for (const p of mm[1].trim().split(/\s+/)) if (p !== '.' && p !== '-A' && p !== '--all') track(p, 'bash');
          }
          break;
        }
        case 'create_plan': planSteps.push({ type: 'create_plan', turn: ti, content: a.plan || a }); break;
        case 'update_plan_step': planSteps.push({ type: 'update_plan_step', turn: ti, content: a }); break;
        default: {
          // any path-ish keys
          for (const k of ['path', 'file_path', 'target', 'pattern']) if (a[k]) track(a[k], 'other');
        }
      }
    }
  }
  if (resp.text && resp.text.trim()) {
    finalTexts.push({ turn: ti, text: resp.text });
  }
}

console.log('=== FILES (op counts) ===');
const sorted = Object.entries(files).sort((x, y) => {
  const sx = x[1].write + x[1].edit, sy = y[1].write + y[1].edit;
  return sy - sx;
});
for (const [p, o] of sorted) {
  if (o.write + o.edit + o.read > 0) console.log(`${o.write}W ${o.edit}E ${o.read}R ${o.bash}B  ${p}`);
}

console.log('\n=== PLAN STEPS (first 60) ===');
planSteps.slice(0, 60).forEach(p => {
  console.log(`[t${p.turn}] ${p.type}: ${JSON.stringify(p.content).slice(0, 400)}`);
});

console.log('\n=== FINAL TEXTS (last 8 turns with text) ===');
finalTexts.slice(-8).forEach(f => {
  console.log(`\n--- turn ${f.turn} (${f.text.length} chars) ---`);
  console.log(f.text.slice(0, 2000));
});
