['ic-search','ic-upload','ic-theme','ic-close','ic-close2'].forEach(id=>{
  const map={ 'ic-search':'search','ic-upload':'upload','ic-theme':'theme','ic-close':'close','ic-close2':'close' };
  const el=document.getElementById(id); if(el) el.innerHTML=ic(map[id],id==='ic-theme'?17:15);
});

const ICONS = {
  search:'<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2"/>',
  upload:'<path d="M12 16V4M12 4l-4 4M12 4l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 18v1a1 1 0 001 1h14a1 1 0 001-1v-1" fill="none" stroke="currentColor" stroke-width="2"/>',
  add:'<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  theme:'<path d="M12 3a9 9 0 109 9 7 7 0 01-9-9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  close:'<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  folder:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  file:'<path d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14 3v4h4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  retry:'<path d="M4 12a8 8 0 018-8 8 8 0 016 2.7M20 12a8 8 0 01-8 8 8 8 0 01-6-2.7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  trash:'<path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  database:'<ellipse cx="12" cy="6" rx="8" ry="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  settings:'<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  knowledge:'<path d="M4 5a2 2 0 012-2h5v16H6a2 2 0 01-2-2zM20 5a2 2 0 00-2-2h-5v16h5a2 2 0 002-2z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  link:'<path d="M9 15l6-6M10 7l1-1a4 4 0 015.7 5.7l-1 1M14 17l-1 1A4 4 0 017.3 12.3l1-1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  robot:'<rect x="5" y="8" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9.5" cy="12.5" r="1.1" fill="currentColor"/><circle cx="14.5" cy="12.5" r="1.1" fill="currentColor"/><path d="M12 4v3M9 4h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  bolt:'<path d="M13 2L4 14h6l-1 8 9-12h-6z" fill="currentColor"/>',
  memory:'<path d="M3 7h18v10H3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 11h2M11 11h2M15 11h2M7 14h2M15 14h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  share:'<circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6" stroke="currentColor" stroke-width="1.6"/>',
  download:'<path d="M12 4v10M12 14l-4-4M12 14l4-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4 18h16" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  graph:'<circle cx="6" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.7 8.6L11 15M16.3 8.6L13 15M8 7h8" stroke="currentColor" stroke-width="1.6"/>',
  chart:'<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  shield:'<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  check:'<path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  warn:'<path d="M12 4l9 16H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
}
function ic(name,size=15){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name]||''}</svg>`}
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const $ = id => document.getElementById(id);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
const CHARACTERS = [
  { id:'char-xiaoshu', name:'小枢', role:'通用助手', mode:'review', snapshotTokenBudget:1200, usedTokens:842,
    groupDefault:'group', lastSnapshot:'v12 · 2 小时前' },
  { id:'char-yanjiu', name:'研究员', role:'深度调研', mode:'auto', snapshotTokenBudget:2000, usedTokens:1530,
    groupDefault:'private', lastSnapshot:'v5 · 昨天' },
  { id:'char-kefu', name:'客服助手', role:'售后支持', mode:'read_only', snapshotTokenBudget:800, usedTokens:610,
    groupDefault:'group', lastSnapshot:'v8 · 今天' },
]
const MEMORIES = {
  'char-xiaoshu': {
    l1:[
      { id:'m1', type:'preference', subject:'主题', key:'dark-mode', content:'用户偏好深色界面，但白天办公用浅色。', visibility:'private', status:'active', conf:.9, sens:'low', source:'手动设置', rev:1, ts:'3 天前' },
      { id:'m2', type:'decision', subject:'交付方式', key:'zip-first', content:'知识库原型优先交付零构建单 HTML，确认后再落地 React 组件。', visibility:'private', status:'active', conf:.95, sens:'low', source:'会话 2024-08-24', rev:1, ts:'今天' },
      { id:'m3', type:'fact', subject:'技术栈', key:'backend', content:'天枢后端为 Node.js + TypeScript（Hono），非 Python。', visibility:'private', status:'active', conf:1, sens:'low', source:'代码核实', rev:1, ts:'2 天前' },
      { id:'m4', type:'constraint', subject:'依赖', key:'no-heavy-vec', content:'知识库不默认引入 Milvus/Neo4j；向量为可选本地增强。', visibility:'group', status:'active', conf:.95, sens:'low', source:'设计评审', rev:1, ts:'昨天' },
      { id:'m5', type:'event', subject:'项目', key:'kb-v2', content:'文件知识库二期已开工，覆盖上传/分块/FTS+向量/RRF。', visibility:'group', status:'candidate', conf:.8, sens:'low', source:'提取器', rev:0, ts:'1 小时前' },
      { id:'m6', type:'experience', subject:'检索', key:'hybrid-better', content:'混合检索（BM25+向量+RRF）优于单一召回，关键词明确场景 BM25 已够。', visibility:'private', status:'conflict', conf:.6, sens:'low', source:'提取器', rev:0, ts:'30 分钟前',
        conflictWith:'旧结论「向量检索一定更好」' },
      { id:'m7', type:'preference', subject:'沟通', key:'concise', content:'用户希望直接、务实、最小改动，不啰嗦。', visibility:'private', status:'superseded', conf:.9, sens:'low', source:'早期会话', rev:2, ts:'一周前',
        note:'已被 v2（含「不臆测、遇歧义提问」）取代' },
    ],
    l2:[
      { id:'l2-1', title:'知识库工程偏好', summary:'轻量优先：FTS5 常驻 + 本地向量可关 + 不引入重服务；单 HTML 原型先行。', related:['m2','m3','m4'], ts:'今天' },
      { id:'l2-2', title:'协作风格', summary:'直接务实、遇歧义先提问、交付带验证证据。', related:['m7'], ts:'3 天前' },
    ],
    l3:{ version:'v12', budget:1200, used:842, blocks:[
      '用户稳定偏好：白天浅色 / 夜间深色界面。',
      '当前约束：知识库不引入 Milvus/Neo4j，向量仅本地可选。',
      '长期约定：原型先行，确认后再落代码。',
      '活跃项目：文件知识库二期（上传/分块/检索）。',
    ]},
  }
}
const LOADOUT = {
  'char-xiaoshu':[
    { tool:'character_memory_search', desc:'读取自己的长尾记忆', on:true },
    { tool:'group_memory_search', desc:'读取同组授权共享记忆', on:true },
    { tool:'knowledge_search', desc:'按绑定搜索文件知识库', on:true },
    { tool:'knowledge_read', desc:'按 Chunk/Source 有限读取', on:true },
    { tool:'knowledge_list_sources', desc:'列出可访问知识源', on:true },
    { tool:'CodeGraph', desc:'现有代码调用图工具', on:true },
    { tool:'Graphify', desc:'现有图谱查询能力', on:true },
    { tool:'Skills / MCP', desc:'技能与 MCP 工具', on:true },
  ],
}
const AUDIT = [
  { ts:'14:02', actor:'用户', action:'批准记忆', target:'m5（知识库二期开工）', detail:'candidate → active' },
  { ts:'13:50', actor:'提取器', action:'写入候选', target:'m6（检索结论）', detail:'与 m4 冲突，留待用户确认' },
  { ts:'13:20', actor:'Run#4821', action:'搜索知识块', target:'退款政策.pdf#chunk_3', detail:'KB=产品手册库，命中 3 块' },
  { ts:'11:10', actor:'研究员', action:'group_memory_search', target:'小枢/m4（依赖约束）', detail:'visibility=group，已授权' },
  { ts:'09:31', actor:'用户', action:'删除知识源', target:'kb-research/旧竞品.pdf', detail:'软删除，索引与工具立即不可见' },
  { ts:'昨天', actor:'Provider', action:'外部向量', target:'—', detail:'未启用，无数据外发' },
]
const KBS = [
  { id:'kb-product', name:'产品手册库', desc:'产品文档 / FAQ / 退款政策', access:'global', binding:'全部角色',
    pendingParse:1, pendingIndex:0,
    docs:[
      { id:'d1', name:'用户手册 v3.md', type:'md', status:'indexed', chunks:14, tokens:6200, version:'v3',
        anchor:'用户手册 v3.md · 第 12–14 行',
        md:'# 用户手册\n\n## 1. 账户与登录\n\n注册后请使用**邮箱**或**手机号**登录。忘记密码可通过「找回密码」邮件重置。\n\n## 2. 退款政策\n\n- 7 天内未使用可**全额退款**；\n- 已使用部分按剩余时长比例退还；\n- 退款将在 `3–5` 个工作日内原路返回。\n\n> 注意：活动特价商品不支持退款。' },
      { id:'d2', name:'退款政策.pdf', type:'pdf', status:'indexed', chunks:9, tokens:4100, version:'v2',
        anchor:'退款政策.pdf · 第 2 页',
        md:'# 退款政策\n\n## 适用商品\n\n仅限标准定价商品，活动特价除外。\n\n## 退款时效\n\n原路退回，预计 `3–5` 个工作日到账。' },
      { id:'d3', name:'API 参考.docx', type:'docx', status:'parsing', chunks:0, tokens:0, version:'—', anchor:'—', md:'' },
      { id:'d4', name:'2024 销售报表.xlsx', type:'xlsx', status:'error', chunks:0, tokens:0, version:'—', anchor:'—', md:'', err:'OCR 失败：扫描件不支持，请上传数字文本。' },
    ]},
  { id:'kb-research', name:'研究资料库', desc:'论文 / 行业报告', access:'department', binding:'研究组',
    pendingParse:0, pendingIndex:2,
    docs:[
      { id:'r1', name:'行业趋势报告.md', type:'md', status:'indexed', chunks:22, tokens:11800, version:'—', anchor:'行业趋势报告.md · 第 5 章', md:'# 行业趋势\n\n## 关键发现\n\n- 知识库+RAG 成为企业落地 LLM 的主流路径；\n- 混合检索（BM25 + 向量 + RRF）显著优于单一召回。' },
      { id:'r2', name:'竞品分析.pdf', type:'pdf', status:'indexing', chunks:0, tokens:0, version:'—', anchor:'—', md:'' },
    ]},
  { id:'kb-private', name:'我的私人笔记', desc:'个人备忘', access:'user', binding:'仅本人',
    pendingParse:0, pendingIndex:0,
    docs:[ { id:'p1', name:'读书笔记.md', type:'md', status:'indexed', chunks:5, tokens:1900, version:'—', anchor:'读书笔记.md · 第 1 行', md:'# 读书笔记\n\n记忆与知识应分离：角色记忆跨会话，知识库按需检索。' } ]},
]
function accessBadge(a){return `<span class="badge ${a}">${a==='global'?'全局':a==='department'?'部门':'个人'}</span>`;}
const state = {
  memChar: 'char-xiaoshu', memTab: 'overview', memFilter: 'all', auditFilter: 'all',
};
function renderMemOverview(){
  const c = CHARACTERS.find(c=>c.id===state.memChar);
  const modes=[['off','关闭'],['read_only','只读'],['review','审阅'],['auto','自动']];
  return `<div class="note-box">${ic('memory',14)} 角色记忆为独立 bounded context，与知识库存储/UI/工具/删除路径完全分离（00 §3 / 01 §13）。</div>
    <div class="sub-grid">
      <div class="panel" style="height:auto"><div class="panel-head">策略</div><div class="panel-body">
        <div class="field"><label>Memory 模式</label>
          <select data-memcfg="mode">${modes.map(m=>`<option ${c.mode===m[0]?'selected':''}>${m[0]}（${m[1]}）</option>`).join('')}</select></div>
        <div class="field"><label>快照 Token 预算</label><input type="number" value="${c.snapshotTokenBudget}" style="width:100px"><span class="tag">已用 ${c.usedTokens}</span></div>
        <div class="field"><label>组共享默认</label><select data-memcfg="groupDefault">${['private','group','user'].map(v=>`<option ${c.groupDefault===v?'selected':''}>${v}</option>`).join('')}</select></div>
        <div class="merge-note">新会话固定注入 Snapshot；当前会话产生的新记忆不改变已固定前缀（提升缓存命中，01 §7）。</div>
      </div></div>
      <div class="panel" style="height:auto"><div class="panel-head">L3 Snapshot</div><div class="panel-body">
        <div class="mem-meta"><span class="stat-pill">版本 ${c.lastSnapshot}</span><span class="stat-pill">${c.usedTokens}/${c.snapshotTokenBudget} tokens</span></div>
        <div class="md" style="margin-top:8px">${MEMORIES[c.id].l3.blocks.map(b=>'• '+esc(b)).join('<br>')}</div>
        <div class="merge-note">「刷新当前会话记忆」会改变上下文前缀，默认建议新建会话（01 §7）。</div>
      </div></div>
    </div>`;
}
function renderMemBrowser(){
  const c = CHARACTERS.find(c=>c.id===state.memChar);
  const m = MEMORIES[c.id];
  const filters=[['all','全部'],['active','active'],['candidate','candidate'],['conflict','conflict'],['superseded','superseded'],['expired','expired']];
  const list = m.l1.filter(x=>state.memFilter==='all'||x.status===state.memFilter);
  const items = list.map(x=>`
    <div class="mem-item">
      <div class="mem-top"><span class="mem-type">${x.type}</span><span class="mem-status ${x.status}">${x.status}</span>
        <span class="badge ${x.visibility}">${x.visibility}</span><b>${esc(x.subject)}</b><span class="doc-sub">conf ${x.conf} · rev ${x.rev}</span></div>
      <div class="mem-content">${esc(x.content)}</div>
      ${x.conflictWith?`<div class="merge-note" style="color:var(--danger)">⚠ 与「${esc(x.conflictWith)}」冲突，未进入稳定 Snapshot，待用户确认。</div>`:''}
      ${x.note?`<div class="merge-note">${esc(x.note)}</div>`:''}
      <div class="mem-meta"><span>来源：${esc(x.source)}</span><span>${x.ts}</span></div>
      <div class="mem-actions">
        ${x.status==='candidate'?`<button class="mini-btn on" data-act="mem:act:approve:${x.id}">${ic('check',12)} 批准</button>`:''}
        ${x.status==='conflict'?`<button class="mini-btn on" data-act="mem:act:resolve:${x.id}">解决冲突</button>`:''}
        <button class="mini-btn" data-act="mem:act:edit:${x.id}">编辑</button>
        <button class="mini-btn" data-act="mem:act:visibility:${x.id}">可见性</button>
        <button class="mini-btn danger" data-act="mem:act:forget:${x.id}">${ic('trash',12)} 遗忘</button>
      </div>
    </div>`).join('');
  const l2 = m.l2.map(x=>`<div class="mem-item"><div class="mem-top"><span class="mem-type">L2 主题</span><b>${esc(x.title)}</b></div>
    <div class="mem-content">${esc(x.summary)}</div><div class="mem-meta"><span>指向 L1：${x.related.join(', ')}</span><span>${x.ts}</span></div></div>`).join('');
  return `<div class="note-box">L1 原子记忆为事实操作基本单位；L2 主题记忆可重建、必须指向 L1 证据（01 §3 / §6）。</div>
    <div class="seg" style="margin-bottom:12px">${filters.map(f=>`<button class="${state.memFilter===f[0]?'active':''}" data-act="mem:filter:${f[0]}">${f[1]}</button>`).join('')}</div>
    <div class="section-title">L1 原子记忆</div>
    <div class="mem-list">${items||'<div class="empty">该状态无记忆</div>'}</div>
    <div class="section-title" style="margin-top:16px">L2 主题记忆（派生）</div>
    <div class="mem-list">${l2}</div>`;
}
function renderMemBinding(){
  const c = CHARACTERS.find(c=>c.id===state.memChar);
  const tools = LOADOUT[c.id]||[];
  const rows = tools.map(t=>`
    <div class="loadout-row">
      <div class="ln"><b>${t.tool}</b><div class="ld">${esc(t.desc)}</div></div>
      <label class="switch"><input type="checkbox" data-loadout="${t.tool}" ${t.on?'checked':''}><span class="slider"></span></label>
    </div>`).join('');
  const bound = KBS.filter(k=>k.access==='global'||k.binding.includes(c.role)||c.id==='char-xiaoshu').map(k=>`<span class="badge ${k.access}">${esc(k.name)}</span>`).join('')||'<span class="muted">无</span>';
  const groupRead = c.groupDefault==='group' || c.groupDefault==='user';
  const matrix = [
    { scope:'自己的 private 记忆', ok:true },
    { scope:'自己的 group 记忆', ok:true },
    { scope:`同组 group 记忆（当前${groupRead?'已授权':'未授权'}）`, ok:groupRead },
    { scope:'其他角色 private 记忆', ok:false },
    { scope:'其他角色组（默认隔离）', ok:false },
    { scope:'已绑定知识库文件', ok:true },
    { scope:'未绑定知识库文件', ok:false },
  ];
  const mrows = matrix.map(r=>`<tr><td style="text-align:left">${esc(r.scope)}</td>
    <td class="${r.ok?'eval-good':'eval-bad'}">${r.ok?'✓ 允许':'✗ 禁止'}</td></tr>`).join('');
  return `<div class="note-box">${ic('shield',14)} 角色工具按权限装配（03 §2）；权限过滤发生在 Repository/Retrieval 层，不依赖模型遵守提示词（03 §3）。禁止把组记忆或知识库正文默认注入系统提示词。</div>
    <div class="section-title">${ic('robot',14)} Character Tool Loadout</div>
    <div class="loadout">${rows}</div>
    <div class="section-title" style="margin-top:16px">${ic('knowledge',14)} 已绑定知识库</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${bound}</div>
    <div class="section-title" style="margin-top:18px">${ic('shield',14)} 权限矩阵（03 §3）</div>
    <table class="eval-table"><thead><tr><th style="text-align:left">访问范围</th><th>结果</th></tr></thead><tbody>${mrows}</tbody></table>
    <div class="note-box" style="margin-top:14px">跨角色越权率为零验收项：B 无权限时无法读取 A 的 private 记忆；B 需经 Binding 才能搜索知识文件（03 §9）。</div>`;
}
function renderMemAudit(){
  const filts=[['all','全部'],['用户','用户'],['提取器','提取器'],['Run','Run'],['Provider','Provider']];
  const list = AUDIT.filter(a=> state.auditFilter==='all' || a.actor.startsWith(state.auditFilter));
  const sum = filts.slice(1).map(f=>`<div class="kpi" style="min-width:104px"><div class="kv">${AUDIT.filter(a=>a.actor.startsWith(f[0])).length}</div><div class="kl">${f[1]}</div></div>`).join('');
  const rows = list.map(a=>`
    <div class="audit-row"><span class="at">${esc(a.ts)}</span><span class="aa">${esc(a.action)}</span>
      <span><b>${esc(a.actor)}</b> → ${esc(a.target)}</span><span class="doc-sub">${esc(a.detail)}</span></div>`).join('');
  return `<div class="note-box">${ic('shield',14)} 统一审计（03 §5）：记录创建/批准/删除、组工具读取、Run 搜索命中、Provider 外发。不保存密钥与完整敏感正文。</div>
    <div class="kpi-row">${sum}</div>
    <div class="seg" style="margin-bottom:12px">${filts.map(f=>`<button class="${state.auditFilter===f[0]?'active':''}" data-act="audit:filter:${f[0]}">${f[1]}（${f[0]==='all'?AUDIT.length:AUDIT.filter(a=>a.actor.startsWith(f[0])).length}）</button>`).join('')}</div>
    <div class="section-title">审计日志</div>
    <div class="audit-list">${rows||'<div class="empty">该筛选无记录</div>'}</div>`;
}
/* ---------- 角色页面脚手架（单域：角色记忆） ---------- */
function renderCrumb(){
  const c = CHARACTERS.find(c=>c.id===state.memChar);
  $('crumb').innerHTML = `角色 · <b>${esc(c.name)}</b>`;
}
function renderSidebar(){
  const sb = $('sidebar');
  sb.innerHTML = `<div class="side-head"><span class="side-title">角色</span></div>
    <div class="kb-list">${CHARACTERS.map(c=>`
      <div class="kb-card ${c.id===state.memChar?'active':''}" data-act="mem:char:${c.id}">
        <div class="kb-name">${ic('memory',15)} ${esc(c.name)}</div>
        <div class="kb-desc">${esc(c.role)} · ${esc(c.mode)}</div>
        <div class="kb-meta"><span class="stat-pill">快照 ${esc(c.lastSnapshot)}</span></div>
      </div>`).join('')}</div>`;
}
function renderTabs(){
  const defs = [['overview','概览'],['browser','记忆浏览器'],['binding','绑定与权限'],['audit','审计']];
  $('tabs').innerHTML = defs.map(([k,l])=>`<div class="tab ${k===state.memTab?'active':''}" data-act="tab:${k}">${l}</div>`).join('');
}
function renderBody(){
  const b = $('tabBody');
  if(state.memTab==='overview') b.innerHTML = renderMemOverview();
  else if(state.memTab==='browser') b.innerHTML = renderMemBrowser();
  else if(state.memTab==='binding') b.innerHTML = renderMemBinding();
  else if(state.memTab==='audit') b.innerHTML = renderMemAudit();
}
function render(){
  renderCrumb(); renderSidebar(); renderTabs(); renderBody();
}

/* ---------- 记忆编辑弹窗 ---------- */
function openMemEdit(id){
  const c = CHARACTERS.find(c=>c.id===state.memChar);
  const x = (MEMORIES[c.id].l1).find(z=>z.id===id); if(!x) return;
  $('memModalBody').innerHTML = `
    <div class="field"><label>类型 / 状态</label>
      <input type="text" value="${esc(x.type)} · ${esc(x.status)}" disabled style="opacity:.7"></div>
    <div class="field"><label>主题</label><input type="text" id="memEditSubject" value="${esc(x.subject)}"></div>
    <div class="field"><label>内容</label><textarea id="memEditContent" style="width:100%;min-height:96px">${esc(x.content)}</textarea></div>
    <div class="field"><label>可见性</label>
      <select id="memEditVis">${['private','group','user'].map(v=>`<option ${x.visibility===v?'selected':''}>${v}</option>`).join('')}</select>
      <div class="hint">private=仅自己 · group=同组授权可读 · user=用户显式跨角色共享</div></div>
    <div class="chunk-meta"><span>来源：${esc(x.source)}</span><span>${esc(x.ts)}</span><span>rev ${x.rev}</span><span>conf ${x.conf}</span></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" data-act="memmodal:close">取消</button>
      <button class="btn primary" data-act="mem:save:${id}">保存修改</button>
    </div>`;
  $('memModal').classList.add('show');
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-act]'); if(!t) return;
  const [act,...rest] = t.dataset.act.split(':');
  const arg = rest.join(':');
  if(act==='tab'){ state.memTab=arg; render(); }
  else if(act==='mem'){
    if(rest[0]==='char'){ state.memChar=arg; state.memFilter='all'; render(); }
    else if(rest[0]==='tab'){ state.memTab=arg; render(); }
    else if(rest[0]==='filter'){ state.memFilter=arg; renderBody(); }
    else if(rest[0]==='act'){
      const [sub,mid]=rest;
      const m = MEMORIES[state.memChar];
      const x = m.l1.find(z=>z.id===mid); if(!x) return;
      if(sub==='approve'){ x.status='active'; x.note='已由用户批准，进入稳定 Snapshot。'; }
      else if(sub==='resolve'){ x.status='active'; x.conflictWith=null; x.note='用户已解决冲突，采纳新结论。'; }
      else if(sub==='forget'){ m.l1 = m.l1.filter(z=>z.id!==mid); }
      else if(sub==='visibility'){ const order=['private','group','user']; x.visibility=order[(order.indexOf(x.visibility)+1)%3]; }
      else if(sub==='edit'){ openMemEdit(mid); return; }
      renderBody();
    }
    else if(rest[0]==='save'){
      const x = MEMORIES[state.memChar].l1.find(z=>z.id===arg); if(x){ x.subject=$('memEditSubject').value; x.content=$('memEditContent').value; x.visibility=$('memEditVis').value; }
      $('memModal').classList.remove('show'); renderBody();
    }
  }
  else if(act==='memmodal'){ $('memModal').classList.remove('show'); }
  else if(act==='audit'){ state.auditFilter=arg; renderBody(); }
  else if(act==='theme'){ const r=document.documentElement; r.dataset.theme = r.dataset.theme==='dark'?'light':'dark'; }
});
document.addEventListener('change', e=>{
  const el = e.target.closest('[data-memcfg]'); if(el){ const c=CHARACTERS.find(c=>c.id===state.memChar); c[el.dataset.memcfg]=el.value; return; }
  const lo = e.target.closest('[data-loadout]'); if(lo){ const row=(LOADOUT[state.memChar]||[]).find(t=>t.tool===lo.dataset.loadout); if(row) row.on=lo.checked; }
});
$('memModal').addEventListener('click', e=>{ if(e.target.id==='memModal') $('memModal').classList.remove('show'); });

render();
