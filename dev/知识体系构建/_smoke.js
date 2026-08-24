// 极简 DOM 桩：仅验证脚本初始化时 render() 是否能跑通、骨架是否被填充
const fs = require('fs');
const vm = require('vm');

function makeEl() {
  return {
    _html: '',
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelector() { return makeEl(); },
    closest() { return null; },
    value: '',
    checked: false,
    parentElement: null,
  };
}
const els = {};
const document = {
  getElementById(id) { return els[id] || (els[id] = makeEl()); },
  documentElement: makeEl(),
  addEventListener() {},
  querySelectorAll() { return []; },
};
const sandbox = { document, console, alert() {}, setTimeout, JSON, Math, Date, Array, Object, String, Number, RegExp, parseInt, parseFloat };
sandbox.window = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(process.argv[2], 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('NO SCRIPT'); process.exit(1); }
try {
  vm.runInContext(m[1], sandbox, { filename: process.argv[2] });
} catch (e) {
  console.error('RUNTIME ERROR:', e.message);
  process.exit(1);
}
const len = id => (els[id] && els[id]._html.length) || 0;
console.log('  sidebar :', len('sidebar'));
console.log('  detail  :', len('detail'));
console.log('  crumb   :', len('crumb'));
const ok = len('sidebar') > 50 && len('detail') > 50 && len('crumb') > 5;
console.log(ok ? 'SMOKE PASS ✅' : 'SMOKE FAIL ❌');
process.exit(ok ? 0 : 1);
