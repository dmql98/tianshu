/* ---------- 文件知识库脚手架（单域：知识库） ---------- */
function renderCrumb(){
  $('crumb').innerHTML = `/ 知识中心 / 文件知识库 / <b>${esc(curKb().name)}</b>`;
}
function renderSidebar(){
  const sb = $('sidebar');
  sb.innerHTML = `<div class="side-head"><span class="side-title">知识库</span><button class="icon-btn" data-act="kb:create" title="新建知识库"><span id="ic-add2"></span></button></div>
    <div class="kb-list">${KBS.map(k=>`
      <div class="kb-card ${k.id===state.kbId?'active':''}" data-act="kb:select:${k.id}">
        <div class="kb-name">${ic('database',15)} ${esc(k.name)}</div>
        <div class="kb-desc">${esc(k.desc)}</div>
        <div class="kb-meta">${accessBadge(k.access)}<span class="stat-pill">${ic('file',12)} ${k.docs.length} 文档</span>
          ${k.pendingParse?`<span class="stat-pill" style="color:var(--warning)">${k.pendingParse} 待解析</span>`:''}
          ${k.pendingIndex?`<span class="stat-pill" style="color:var(--info)">${k.pendingIndex} 待索引</span>`:''}</div>
        <div class="kb-manage">
          <button class="mini-btn" data-act="kb:bind:${k.id}">${ic('share',12)} 绑定/共享</button>
          <button class="mini-btn" data-act="doc:none">下载原件</button>
        </div>
      </div>`).join('')}</div>`;
  const a=$('ic-add2'); if(a) a.innerHTML=ic('add',15);
}
function renderTabs(){
  const defs = [['files','文件'],['debug','检索调试'],['cite','引用预览'],['graph','图谱探索'],['eval','评测']];
  $('tabs').innerHTML = defs.map(([k,l])=>`<div class="tab ${k===state.tab?'active':''}" data-act="tab:${k}">${l}</div>`).join('');
}
function renderBody(){
  const b = $('tabBody');
  if(state.tab==='files') b.innerHTML = renderFiles();
  else if(state.tab==='debug') b.innerHTML = renderDebug();
  else if(state.tab==='cite') b.innerHTML = renderCite();
  else if(state.tab==='graph') b.innerHTML = renderGraph();
  else if(state.tab==='eval') b.innerHTML = renderEval();
}
function render(){
  renderCrumb(); renderSidebar(); renderTabs(); renderBody();
}

/* ---------- chunk 详情弹窗 ---------- */
function openChunk(id){
  const c = CHUNK_POOL.find(x=>x.id===id); if(!c) return;
  $('chunkModalTitle').textContent = `文档片段 · ${c.source} chunk ${c.chunkIndex}`;
  $('chunkModalBody').innerHTML = `
    <div class="chunk-meta"><span>来源：${esc(c.source)}</span><span>chunk ${c.chunkIndex}</span>
      <span>行 ${c.startLine}–${c.endLine}</span><span class="score">score ${c.score}</span></div>
    <div class="md">${esc(c.content)}</div>
    <div class="meta-grid"><b>headingPath</b><span>退款政策 / 退款时效</span><b>tokenCount</b><span>48</span>
      <b>contentSha256</b><span>9f3c…a1</span><b>sourceAnchor</b><span>${esc(c.source)} · ${c.startLine}–${c.endLine} 行</span></div>`;
  $('chunkModal').classList.add('show');
}

/* ---------- 事件 ---------- */
document.addEventListener('click', e=>{
  const t = e.target.closest('[data-act]'); if(!t) return;
  const [act,...rest] = t.dataset.act.split(':');
  const arg = rest.join(':');
  if(act==='kb'){
    if(rest[0]==='select'){ state.kbId=arg; const d=curDocs()[0]; state.docId=d?d.id:state.docId; render(); }
    else if(rest[0]==='create'){ alert('演示：弹出「新建知识库」对话框（名称 / 描述 / 访问范围 global·department·user）。'); }
    else if(rest[0]==='bind'){ alert('演示：配置知识库共享开关 access_level 与角色绑定。'); }
  }
  else if(act==='tab'){ state.tab=arg; render(); }
  else if(act==='doc'){ if(rest[0]==='select'){ state.docId=arg; renderBody(); } else alert('演示操作：下载原件 / 重试 / 删除。'); }
  else if(act==='preset'){ state.preset=arg; renderBody(); }
  else if(act==='upload'){ const kb=curKb(); kb.docs.unshift({id:'n'+Date.now(),name:'新上传-示例.pdf',type:'pdf',status:'parsing',chunks:0,tokens:0,version:'—',anchor:'—',md:''}); kb.pendingParse++; render(); }
  else if(act==='search'){ runSearch(); $('results').innerHTML = renderResults(); }
  else if(act==='raw'){ state.showRaw = arg==='1'; renderBody(); }
  else if(act==='chunk'){ openChunk(arg); }
  else if(act==='modal'){ $('chunkModal').classList.remove('show'); }
  else if(act==='theme'){ const r=document.documentElement; r.dataset.theme = r.dataset.theme==='dark'?'light':'dark'; }
  else if(act==='graph'){ state.graphNode = state.graphNode===arg?null:arg; renderBody(); }
});
document.addEventListener('input', e=>{
  const el = e.target.closest('[data-cfg]'); if(!el) return;
  const k = el.dataset.cfg;
  if(el.type==='checkbox') state.cfg[k]=el.checked;
  else if(el.type==='range'){ state.cfg[k]=+el.value; const v=el.parentElement.querySelector('.range-val'); if(v)v.textContent=el.value; }
  else state.cfg[k]=el.value;
  if(k==='searchMode'||k==='useLocalVector'){ renderBody(); }
});
$('chunkModal').addEventListener('click', e=>{ if(e.target.id==='chunkModal') $('chunkModal').classList.remove('show'); });

render();
