const fs = require('fs');
const src = fs.readFileSync('天枢知识库前端原型.html', 'utf8');

// 通过括号计数从原文件精确抽取某个函数 / const 块
function extractBlock(s, startMarker, open = '{', close = '}') {
  const i = s.indexOf(startMarker);
  if (i < 0) throw new Error('not found: ' + startMarker);
  const j = s.indexOf(open, i);
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === open) depth++;
    else if (s[k] === close) depth--;
    if (depth === 0) return s.slice(i, k + 1);
  }
  throw new Error('unclosed: ' + startMarker);
}

const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>') + '</style>'.length);
const head1 = `<!DOCTYPE html>\n<html lang="zh-CN" data-theme="light">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n`;
const fontLink = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css" />\n`;

// ---- 共享基础（务必先于图标初始化） ----
const ICONS = extractBlock(src, 'const ICONS =', '{', '}');
const icFn = extractBlock(src, 'function ic(');
const escFn = extractBlock(src, 'function esc(');
const dollarFn = extractBlock(src, 'const $ =');
const accessBadge = extractBlock(src, 'function accessBadge(');
const base = ICONS + '\n' + icFn + '\n' + escFn + '\n' + dollarFn + '\n';

// ========== 角色页面 ==========
const CHARACTERS = extractBlock(src, 'const CHARACTERS =', '[', ']');
const MEMORIES = extractBlock(src, 'const MEMORIES =', '{', '}');
const LOADOUT = extractBlock(src, 'const LOADOUT =', '{', '}');
const AUDIT = extractBlock(src, 'const AUDIT =', '[', ']');
const KBS = extractBlock(src, 'const KBS =', '[', ']'); // 绑定与权限里要用
const renderMemOverview = extractBlock(src, 'function renderMemOverview(');
const renderMemBrowser = extractBlock(src, 'function renderMemBrowser(');
const renderMemBinding = extractBlock(src, 'function renderMemBinding(');
const renderMemAudit = extractBlock(src, 'function renderMemAudit(');
const charScaffold = fs.readFileSync('_scaffold_char.js', 'utf8');

const charState = `const state = {
  memChar: 'char-xiaoshu', memTab: 'overview', memFilter: 'all', auditFilter: 'all',
};`;

const charBody = `<body>
<div class="app">
  <header class="topbar">
    <div class="brand"><span class="logo">枢</span> 天枢</div>
    <span class="crumb" id="crumb"></span>
    <div class="header-search">
      <span id="ic-search"></span>
      <input placeholder="搜索记忆、角色..." />
    </div>
    <button class="icon-btn" id="themeBtn" title="切换深浅色" data-act="theme"><span id="ic-theme"></span></button>
  </header>
  <div class="body">
    <aside class="sidebar" id="sidebar"></aside>
    <main class="main">
      <nav class="tabs" id="tabs"></nav>
      <section class="tab-body" id="tabBody"></section>
    </main>
  </div>
</div>

<!-- 记忆编辑弹窗 -->
<div class="modal-mask" id="memModal">
  <div class="modal">
    <div class="modal-head"><span class="mt">编辑记忆</span>
      <button class="icon-btn" data-act="memmodal:close"><span id="ic-close2"></span></button></div>
    <div class="modal-body" id="memModalBody"></div>
  </div>
</div>

<script>
`;

const charIconInit = `['ic-search','ic-upload','ic-theme','ic-close','ic-close2'].forEach(id=>{
  const map={ 'ic-search':'search','ic-upload':'upload','ic-theme':'theme','ic-close':'close','ic-close2':'close' };
  const el=document.getElementById(id); if(el) el.innerHTML=ic(map[id],id==='ic-theme'?17:15);
});
`;

fs.writeFileSync('角色页面.html',
  head1 + fontLink + css + `</head>\n` + charBody +
  base + charIconInit +
  CHARACTERS + '\n' + MEMORIES + '\n' + LOADOUT + '\n' + AUDIT + '\n' + KBS + '\n' + accessBadge + '\n' +
  charState + '\n' +
  renderMemOverview + '\n' + renderMemBrowser + '\n' + renderMemBinding + '\n' + renderMemAudit + '\n' +
  charScaffold + `</script>\n</body>\n</html>\n`);

// ========== 文件知识库 ==========
const CHUNK_POOL = extractBlock(src, 'const CHUNK_POOL =', '[', ']');
const PRESETS = extractBlock(src, 'const PRESETS =', '[', ']');
const QUERY_PARAMS_SCHEMA = extractBlock(src, 'const QUERY_PARAMS_SCHEMA =', '{', '}');
const GRAPH = extractBlock(src, 'const GRAPH =', '{', '}');
const EVAL = extractBlock(src, 'const EVAL =', '{', '}');
const curKb = extractBlock(src, 'function curKb(');
const curDocs = extractBlock(src, 'function curDocs(');
const statusText = extractBlock(src, 'function statusText(');
const cls = extractBlock(src, 'function cls(');
const renderFiles = extractBlock(src, 'function renderFiles(');
const renderDebug = extractBlock(src, 'function renderDebug(');
const runSearch = extractBlock(src, 'function runSearch(');
const renderResults = extractBlock(src, 'function renderResults(');
const renderCite = extractBlock(src, 'function renderCite(');
const renderGraph = extractBlock(src, 'function renderGraph(');
const renderEval = extractBlock(src, 'function renderEval(');
const avgFn = extractBlock(src, 'function avg(');
const kbScaffold = fs.readFileSync('_scaffold_kb.js', 'utf8');

const kbState = `const state = {
  kbId: 'kb-product', tab: 'files', docId: 'd1', showRaw: false,
  cfg: { searchMode: 'keyword', useLocalVector: false, useReranker: false, useGraphPpr: false,
         finalTopK: 10, simThreshold: 0.2, vecWeight: 0.7, bm25Weight: 0.3 },
  preset: 'general', chunkEngineVersion: '3',
  graphNode: null,
  results: null,
};`;

const kbBody = `<body>
<div class="app">
  <header class="topbar">
    <div class="brand"><span class="logo">枢</span> 天枢</div>
    <span class="crumb" id="crumb"></span>
    <div class="header-search">
      <span id="ic-search"></span>
      <input placeholder="搜索文档、知识块、记忆..." />
    </div>
    <button class="btn primary" id="uploadBtn" data-act="upload:click"><span id="ic-upload"></span> 上传文档</button>
    <button class="icon-btn" id="themeBtn" title="切换深浅色" data-act="theme"><span id="ic-theme"></span></button>
  </header>
  <div class="body">
    <aside class="sidebar" id="sidebar"></aside>
    <main class="main">
      <nav class="tabs" id="tabs"></nav>
      <section class="tab-body" id="tabBody"></section>
    </main>
  </div>
</div>

<!-- chunk 详情弹窗 -->
<div class="modal-mask" id="chunkModal">
  <div class="modal">
    <div class="modal-head"><span class="mt" id="chunkModalTitle">文档片段详情</span>
      <button class="icon-btn" data-act="modal:close"><span id="ic-close"></span></button></div>
    <div class="modal-body" id="chunkModalBody"></div>
    <div class="foot-note">来源位置与相似度为原型演示数据；真实实现由 backend 经 knowledge_search 工具返回。</div>
  </div>
</div>

<script>
`;

const kbIconInit = `['ic-search','ic-upload','ic-theme','ic-close'].forEach(id=>{
  const map={ 'ic-search':'search','ic-upload':'upload','ic-theme':'theme','ic-close':'close' };
  const el=document.getElementById(id); if(el) el.innerHTML=ic(map[id],id==='ic-theme'?17:15);
});
`;

fs.writeFileSync('文件知识库.html',
  head1 + fontLink + css + `</head>\n` + kbBody +
  base + kbIconInit +
  KBS + '\n' + CHUNK_POOL + '\n' + PRESETS + '\n' + QUERY_PARAMS_SCHEMA + '\n' + GRAPH + '\n' + EVAL + '\n' +
  curKb + '\n' + curDocs + '\n' + statusText + '\n' + cls + '\n' + accessBadge + '\n' +
  kbState + '\n' +
  renderFiles + '\n' + renderDebug + '\n' + runSearch + '\n' + renderResults + '\n' + renderCite + '\n' + renderGraph + '\n' + renderEval + '\n' + avgFn + '\n' +
  kbScaffold + `</script>\n</body>\n</html>\n`);

console.log('done: 角色页面.html + 文件知识库.html');
