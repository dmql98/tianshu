const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const turns = j.turns;

const toolStats = {};
const fileTouches = {}; // path -> {reads, writes, edits}
const toolSeq = [];
let reasoningChars = 0, textChars = 0;

function summarizeArgs(args) {
  if (!args) return '';
  if (typeof args === 'string') return args.length > 120 ? args.slice(0, 120) + '…' : args;
  try {
    const s = JSON.stringify(args);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch { return String(args); }
}

for (const t of turns) {
  const tc = t.response && t.response.toolCalls;
  if (Array.isArray(tc)) {
    for (const c of tc) {
      const name = c.name || c.function?.name || '?';
      const args = c.args ?? c.function?.arguments;
      toolStats[name] = (toolStats[name] || 0) + 1;
      toolSeq.push({ name, args: summarizeArgs(args) });
      // extract file paths from args
      if (args && typeof args === 'object') {
        const cand = [args.file_path, args.path, args.target, args.pattern].filter(Boolean);
        for (const p of cand) {
          if (typeof p === 'string') {
            fileTouches[p] = fileTouches[p] || { reads: 0, writes: 0, edits: 0, others: 0 };
            fileTouches[p].others++;
          }
        }
      }
    }
  }
  if (t.response && t.response.text) textChars += t.response.text.length;
  if (t.response && t.response.reasoning) reasoningChars += String(t.response.reasoning).length;
}

console.log('=== TOOL USAGE (name -> count) ===');
for (const [k, v] of Object.entries(toolStats).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log('\n=== TOTAL TOOL CALLS:', toolSeq.length, '===');
console.log('=== TOTAL TEXT CHARS:', textChars, '=== REASONING CHARS:', reasoningChars, '===');

console.log('\n=== FILE PATHS TOUCHED (via args) ===');
const paths = Object.keys(fileTouches);
console.log('count:', paths.length);
for (const p of paths.slice(0, 120)) console.log(`${fileTouches[p].others}  ${p}`);
