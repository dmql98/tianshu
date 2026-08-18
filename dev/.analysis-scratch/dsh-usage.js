const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
const records = lines.map(l => JSON.parse(l));
let first = null, last = null;
let inTok = 0, outTok = 0, cacheHit = 0, cacheMiss = 0, reasonTok = 0, llmMs = 0, nUsage = 0;
let reasonChars = 0, textChars = 0, toolChars = 0;
let nSteps = 0;
for (const r of records) {
  if (first === null || r.time < first) first = r.time;
  if (last === null || r.time > last) last = r.time;
  if (r.type === 'step/end') nSteps++;
  if (r.type === 'assistant/message') {
    const u = r.data.usage;
    if (u) {
      nUsage++;
      inTok += u.input_tokens || u.inputTokens || 0;
      outTok += u.output_tokens || u.outputTokens || 0;
      cacheHit += u.cache_hit_tokens || 0;
      cacheMiss += u.cache_miss_tokens || 0;
      reasonTok += u.reasoning_tokens || 0;
      llmMs += u.total_ms || u.duration_ms || 0;
    }
    for (const c of r.data.message.content || []) {
      if (c.type === 'reasoning') reasonChars += (c.text || '').length;
      else if (c.type === 'text') textChars += (c.text || '').length;
    }
  }
  if (r.type === 'tool/result') {
    for (const c of r.data.message.content || []) {
      for (const cc of c.content || []) if (cc.type === 'text') toolChars += (cc.text || '').length;
    }
  }
}
console.log('=== DSH SESSION ===');
console.log('time span ms:', last - first, '=', ((last - first) / 60000).toFixed(1), 'min');
console.log('steps (step/end):', nSteps);
console.log('usage records:', nUsage);
console.log('input tokens:', inTok, ' output tokens:', outTok, ' cacheHit:', cacheHit, ' cacheMiss:', cacheMiss, ' reasoning tokens:', reasonTok);
console.log('llm total ms:', llmMs, '=', (llmMs / 60000).toFixed(1), 'min');
console.log('reasoning chars:', reasonChars, ' text chars:', textChars, ' tool result chars:', toolChars);
