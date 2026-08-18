const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
const typeCount = {};
const samples = {};
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { continue; }
  const t = o.type || '?';
  typeCount[t] = (typeCount[t] || 0) + 1;
  if (!samples[t]) samples[t] = o;
}
console.log('=== RECORD TYPES ===');
for (const [t, c] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) console.log(`${t}: ${c}`);
console.log('\n=== SAMPLE KEYS PER TYPE (first occurrence) ===');
for (const [t, o] of Object.entries(samples)) {
  console.log(`\n--- ${t} ---`);
  console.log('keys:', Object.keys(o).join(', '));
  if (o.data && typeof o.data === 'object') console.log('data keys:', Object.keys(o.data).join(', '));
  const s = JSON.stringify(o);
  console.log('sample:', s.length > 500 ? s.slice(0, 500) + '…' : s);
}
