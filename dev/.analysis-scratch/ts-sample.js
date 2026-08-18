const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const turns = j.turns;

// show raw structure of first toolCall
const t0 = turns.find(t => t.response && t.response.toolCalls && t.response.toolCalls.length);
if (t0) {
  console.log('=== SAMPLE TOOLCALL (turn with first toolcall) ===');
  console.log(JSON.stringify(t0.response.toolCalls[0], null, 1).slice(0, 1500));
  console.log('\n=== SAMPLE FULL TOOLCALL ARGS from an edit ===');
  const te = turns.find(t => t.response && t.response.toolCalls && t.response.toolCalls.some(c => (c.name || c.function?.name) === 'edit'));
  if (te) {
    const c = te.response.toolCalls.find(c => (c.name || c.function?.name) === 'edit');
    const args = c.args ?? c.function?.arguments;
    console.log('edit args keys:', Object.keys(args));
    console.log(JSON.stringify(args).slice(0, 800));
  }
}
