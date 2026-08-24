const fs = require('fs');
const dir = '知识体系构建';
const SRC = dir + '/天枢知识库前端原型.html'; // 纯净源，从未被覆盖
const OUT = dir + '/角色页面.html';
const src = fs.readFileSync(SRC, 'utf8');
const s0 = src.indexOf('<script>') + 8;
const s1 = src.lastIndexOf('</script>');
const script = src.slice(s0, s1);

function grab(startToken, closeCh) {
  const start = src.indexOf(startToken);
  if (start < 0) throw new Error('未找到 ' + startToken);
  const rel = src.slice(start).search(/[\[{]/);
  if (rel < 0) throw new Error('未找到开括号 ' + startToken);
  const openIdx = start + rel;
  const openCh = src[openIdx];
  const closeCh2 = openCh === '[' ? ']' : '}';
  let depth = 0, i = openIdx;
  for (; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh2) { depth--; if (depth === 0) return src.slice(start, i + 1) + (closeCh === ';' ? ';' : ''); }
  }
  throw new Error('括号不匹配 ' + startToken);
}

const css = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>'));
const iconsBlock = src.slice(src.indexOf('const ICONS'), src.indexOf('const KBS'));
const escFn = grab('function esc', '}');

const MEMORIES = grab('const MEMORIES', ';');
const LOADOUT = grab('const LOADOUT', ';');
const AUDIT = grab('const AUDIT', ';');
const KBS = grab('const KBS', ';');
const fOverview = grab('function renderMemOverview', '}');
const fBrowser = grab('function renderMemBrowser', '}');
const fBinding = grab('function renderMemBinding', '}');
const fAudit = grab('function renderMemAudit', '}');

const newPart = fs.readFileSync(dir + '/_char_new.js', 'utf8');

const NEW_CSS = `
/* === 角色中心新组件 === */
.side-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px}
.side-title{font-size:13px;color:var(--ink-mid);font-weight:600;letter-spacing:.04em}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;max-width:880px}
.field{display:flex;flex-direction:column;gap:6px}
.field label{font-size:12px;color:var(--ink-mid);font-weight:600}
.field input,.field textarea,.field select,.search-input{background:var(--surface-2);border:1px solid var(--border);color:var(--ink);border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit;outline:none}
.field textarea{min-height:54px;resize:vertical;line-height:1.5}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--accent)}
.chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--ink)}
.chip button{background:none;border:none;color:var(--ink-mid);cursor:pointer;font-size:13px;line-height:1;padding:0}
.chip.dashed{border-style:dashed;cursor:pointer;color:var(--accent)}
.chip-input{background:var(--surface-2);border:1px dashed var(--border);border-radius:999px;padding:5px 12px;font-size:12px;color:var(--ink);outline:none;width:140px}
.chip-input:focus{border-color:var(--accent)}
.skin-binder{display:flex;flex-wrap:wrap;gap:16px;margin-top:8px}
.skin-card{width:200px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px}
.skin-card.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.skin-card-avatar{width:100%;height:96px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:30px;color:#fff;font-weight:700}
.skin-card-name{font-weight:600;font-size:14px}
.skin-card-desc{font-size:12px;color:var(--ink-mid)}
.skin-foot{margin-top:4px}
.nested-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:14px}
.tab.sm{padding:6px 14px;font-size:13px;border-radius:8px 8px 0 0}
.tool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.tool-row{display:flex;align-items:center;justify-content:space-between;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 14px}
.tool-name{font-family:var(--mono);font-size:13px}
.chip-list{display:flex;flex-wrap:wrap;gap:8px}
.muted{color:var(--ink-mid);font-size:13px}
.detail-wrap{padding:22px 26px;max-width:1180px}
.detail-head{display:flex;align-items:center;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--border)}
.detail-avatar{width:54px;height:54px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;flex-shrink:0}
.detail-headinfo{display:flex;flex-direction:column;gap:3px}
.detail-name{font-size:18px;font-weight:700;display:flex;align-items:center;gap:8px}
.detail-sub{font-size:12px;color:var(--ink-mid)}
.tag{font-size:11px;font-family:var(--mono);background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:1px 7px;color:var(--ink-mid);font-weight:500}
.tabs{display:flex;gap:4px;padding:16px 0 0}
.tab{padding:9px 18px;font-size:14px;color:var(--ink-mid);cursor:pointer;border-radius:9px 9px 0 0;border-bottom:2px solid transparent}
.tab:hover{color:var(--ink)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.tab-body{padding:18px 0 30px}
.skin-editor{display:grid;grid-template-columns:320px 1fr;gap:20px;margin-top:14px}
.skin-left{display:flex;flex-direction:column;gap:14px}
.skin-right{display:flex;flex-direction:column;gap:14px}
.visual-slot{background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;align-items:center}
.visual-slot.portrait .vs-preview{width:232px;aspect-ratio:3/4;height:auto;margin:0 auto}
.visual-slot.original .vs-preview{width:64px;height:64px}
.visual-slot.avatar{display:flex;flex-direction:row;align-items:center;gap:14px}
.visual-slot.avatar .vs-preview{width:64px;height:64px;flex:0 0 64px}
.vs-preview{width:100%;border-radius:8px;overflow:hidden;background:linear-gradient(135deg,rgba(120,120,200,.15),rgba(120,120,200,.04));display:flex;align-items:center;justify-content:center}
.vs-preview img,.vs-preview video{width:100%;height:100%;object-fit:cover}
.vs-preview.lg{width:64px;height:64px}
.vs-name{font-size:12px;color:var(--ink-mid);font-weight:600}
.visual-slot-empty{color:var(--ink-mid);font-size:12px;opacity:.7}
.animations{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:4px}
.visual-slot.motion .vs-preview{width:130px;height:130px;margin:0 auto}
.kpi-row{display:flex;gap:14px;flex-wrap:wrap}
.kpi{flex:1;min-width:140px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px;padding:16px}
.kv{font-size:26px;font-weight:700}
.kl{font-size:12px;color:var(--ink-mid);margin-top:2px}
.toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%) translateY(20px);background:var(--ink);color:var(--surface);padding:10px 18px;border-radius:10px;font-size:13px;opacity:0;pointer-events:none;transition:all .2s;z-index:99}
.toast.show{opacity:.94;transform:translateX(-50%) translateY(0)}
`;

const BODY = `<body>
<div class="app">
  <header class="topbar">
    <div class="brand"><span class="logo">枢</span> 天枢 · 角色中心</div>
    <div class="domain-switch" id="sectionSwitch">
      <button data-act="section:character" class="active">角色</button>
      <button data-act="section:skin">皮肤</button>
    </div>
    <span class="crumb" id="crumb"></span>
    <div class="header-search"><input placeholder="搜索角色 / 皮肤…"></div>
    <button class="icon-btn" data-act="theme" title="切换主题"><span id="ic-theme"></span></button>
  </header>
  <div class="body">
    <aside class="sidebar" id="sidebar"></aside>
    <main class="main"><div id="detail"></div></main>
  </div>
</div>
<div class="modal-mask" id="memModal"><div class="modal"><div class="modal-title">编辑记忆</div>
  <label class="modal-label">主题</label><input id="memEditSubject" class="search-input">
  <label class="modal-label">内容</label><textarea id="memEditContent" class="modal-textarea"></textarea>
  <label class="modal-label">可见性</label><select id="memEditVis" class="search-input"><option value="private">私有 private</option><option value="group">分组 group</option><option value="user">用户 user</option></select>
  <div class="modal-actions"><button class="btn" data-act="memmodal">取消</button><button class="btn primary" data-act="mem:save">保存</button></div>
</div></div>
<script>`;

const TAIL = `</script>
</html>`;

const html = `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>天枢 · 角色中心</title>
<style>${css}
${NEW_CSS}</style>
</head>
${BODY}
${iconsBlock}
${escFn}
const $ = id => document.getElementById(id);
const state = { section:'character', charId:'char-xiaoshu', memChar:'char-xiaoshu', charTab:'basic', memTab:'overview', memFilter:'all', auditFilter:'all', skinId:'ram', skinPreview:{} };
${MEMORIES}
${LOADOUT}
${AUDIT}
${KBS}
${fOverview}
${fBrowser}
${fBinding}
${fAudit}
${newPart}
${TAIL}`;

fs.writeFileSync(OUT, html);
console.log('built 角色页面.html', html.length, 'bytes');
