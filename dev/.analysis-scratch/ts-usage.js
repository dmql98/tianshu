const fs = require('fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const turns = j.turns;
let first = null, last = null;
let inTok = 0, outTok = 0, reasonTok = 0, nUsage = 0, llmMs = 0;
let reasonChars = 0, textChars = 0, toolChars = 0;
let nToolCalls = 0;
const models = {};
for (const t of turns) {
  const ts = t.timestamp;
  if (first === null || ts < first) first = ts;
  if (last === null || ts > last) last = ts;
  models[t.request.model] = (models[t.request.model] || 0) + 1;
  const u = t.response && t.response.usage;
  if (u) {
    nUsage++;
    inTok += u.input_tokens || u.inputTokens || 0;
    outTok += u.output_tokens || u.outputTokens || 0;
    reasonTok += u.reasoning_tokens || 0;
    llmMs += u.total_ms || u.duration_ms || 0;
  }
  if (t.response && t.response.text) textChars += t.response.text.length;
  if (t.response && t.response.reasoning) reasonChars += String(t.response.reasoning).length;
  if (Array.isArray(t.response && t.response.toolCalls)) nToolCalls += t.response.toolCalls.length;
}
console.log('=== TIANSHU SESSION ===');
console.log('time span ms:', last - first, '=', ((last - first) / 60000).toFixed(1), 'min');
console.log('models:', JSON.stringify(models));
console.log('usage records:', nUsage, ' toolCalls:', nToolCalls);
console.log('input tokens:', inTok, ' output tokens:', outTok, ' reasoning tokens:', reasonTok);
console.log('llm total ms:', llmMs, '=', (llmMs / 60000).toFixed(1), 'min');
console.log('reasoning chars:', reasonChars, ' text chars:', textChars);
