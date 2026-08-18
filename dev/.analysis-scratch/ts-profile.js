const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log('TOP KEYS:', Object.keys(j).join(', '));
const turns = j.turns;
console.log('TURNS:', Array.isArray(turns) ? turns.length : 'n/a');
if (Array.isArray(turns) && turns.length) {
  const t0 = turns[0];
  console.log('TURN0 KEYS:', Object.keys(t0).join(', '));
  if (t0.request) console.log('REQ KEYS:', Object.keys(t0.request).join(', '));
  if (t0.response) console.log('RESP KEYS:', Object.keys(t0.response).join(', '));
  // find user messages in turn 0
  const msgs = t0.request && t0.request.messages;
  if (Array.isArray(msgs)) {
    msgs.forEach((m, i) => {
      const role = m.role;
      let txt = '';
      try { txt = JSON.stringify(m.content); } catch (e) { txt = String(m.content); }
      if (txt.length > 600) txt = txt.slice(0, 600) + '...[truncated]';
      console.log(`  msg[${i}] role=${role}: ${txt}`);
    });
  }
}
