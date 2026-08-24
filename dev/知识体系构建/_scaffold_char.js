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
