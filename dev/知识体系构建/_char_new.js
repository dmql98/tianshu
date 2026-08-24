/* ===================== 数据：角色 / 皮肤 ===================== */
const CHARACTERS = [
  { id:'char-xiaoshu', name:'小枢', description:'天枢默认通用助手，负责跨模块协调与记忆管理演示。', color:'#c8960a', role:'both', enabled:true, default_strategy:'Review', groups:['general'], groupDefault:'group', skinId:'xiaohong', snapshotTokenBudget:1200, usedTokens:842, lastSnapshot:'v12 · 2 小时前',
    tools:[{name:'bash'},{name:'read'},{name:'write'},{name:'websearch'},{name:'get_time'},{name:'skill_manager'}],
    skills:['content-writer'], skillBindings:['content-writer'],
    memory:{enabled:true,charLimit:2000,selfEvolution:false},
    soul:'你是天枢的通用助手小枢，耐心、严谨、以用户目标为先。', userProfile:'用户偏好简洁直接的沟通。', memoryContent:'', customPrompt:'',
    stats:{sessionCount:342, lastActive:Date.now()-1800e3} },
  { id:'xiaohong', name:'小红', description:'营销内容创作助手。', color:'#ef4444', role:'main', enabled:true, default_strategy:'Auto Approve', groups:['marketing'], groupDefault:'group', skinId:'xiaohong',
    tools:[{name:'bash'},{name:'read'},{name:'write'},{name:'websearch'}], skills:[], skillBindings:[],
    memory:{enabled:true,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:88, lastActive:Date.now()-86400e3} },
  { id:'ram', name:'雷姆', description:'rezero 组蓝发女仆，家务全能、战斗力爆表。', color:'#ec4899', role:'both', enabled:true, default_strategy:'Auto Approve', groups:['rezero'], groupDefault:'group', skinId:'ram',
    tools:[{name:'bash'},{name:'read'},{name:'write'},{name:'websearch'},{name:'get_time'}], skills:[], skillBindings:[],
    memory:{enabled:true,charLimit:1500,selfEvolution:true}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:210, lastActive:Date.now()-7200e3} },
  { id:'taro', name:'太郎', description:'研究型子 Agent，负责资料检索与综述。', color:'#3b82f6', role:'sub', enabled:true, default_strategy:'Read Only', groups:['research'], groupDefault:'private', skinId:null,
    tools:[{name:'websearch'},{name:'webfetch'},{name:'read'}], skills:['web-researcher'], skillBindings:['web-researcher'],
    memory:{enabled:false,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:54, lastActive:Date.now()-3600e3*5} },
  { id:'ui-designer', name:'UI设计师', description:'前端与界面设计专家。', color:'#8b5cf6', role:'main', enabled:true, default_strategy:'Review', groups:['design'], groupDefault:'group', skinId:'ui-designer',
    tools:[{name:'read'},{name:'write'},{name:'bash'}], skills:['code-reviewer'], skillBindings:['code-reviewer'],
    memory:{enabled:true,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:131, lastActive:Date.now()-3600e3*12} },
  { id:'yi', name:'易', description:'数据分析与报表助手。', color:'#14b8a6', role:'both', enabled:true, default_strategy:'Review', groups:['data'], groupDefault:'group', skinId:'yi',
    tools:[{name:'bash'},{name:'read'},{name:'write'}], skills:['data-analyst'], skillBindings:['data-analyst'],
    memory:{enabled:true,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:77, lastActive:Date.now()-3600e3*3} },
  { id:'ziwei', name:'紫微', description:'知识治理与权限审计助手。', color:'#d4a017', role:'both', enabled:false, default_strategy:'Review', groups:['governance'], groupDefault:'private', skinId:null,
    tools:[{name:'read'},{name:'grep'}], skills:[], skillBindings:[],
    memory:{enabled:true,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:19, lastActive:Date.now()-3600e3*30} },
  { id:'coder', name:'程序员', description:'通用编码助手。', color:'#0ea5e9', role:'both', enabled:true, default_strategy:'Auto Approve', groups:['eng'], groupDefault:'group', skinId:null,
    tools:[{name:'bash'},{name:'read'},{name:'write'},{name:'edit'},{name:'glob'}], skills:['code-reviewer'], skillBindings:['code-reviewer'],
    memory:{enabled:true,charLimit:2000,selfEvolution:false}, soul:'', userProfile:'', memoryContent:'', customPrompt:'',
    stats:{sessionCount:265, lastActive:Date.now()-600e3} },
];
const SKINS = [
  { id:'xiaohong', name:'小红', color:'#ef4444', description:'小红专属皮肤', boundCharacters:['xiaohong','char-xiaoshu'], motions:{idle:true,thinking:false,working:true,speaking:true,success:false,error:false}, portrait:true, avatar:true },
  { id:'ram', name:'雷姆', color:'#ec4899', description:'雷姆专属皮肤', boundCharacters:['ram'], motions:{idle:true,thinking:true,working:true,speaking:true,success:true,error:true}, portrait:true, avatar:true },
  { id:'taro', name:'太郎', color:'#3b82f6', description:'太郎专属皮肤', boundCharacters:['taro'], motions:{idle:true,thinking:false,working:true,speaking:false,success:false,error:true}, portrait:true, avatar:false },
  { id:'ui-designer', name:'UI设计师', color:'#8b5cf6', description:'UI设计师专属皮肤', boundCharacters:['ui-designer'], motions:{idle:true,thinking:true,working:true,speaking:true,success:false,error:false}, portrait:false, avatar:true },
  { id:'yi', name:'易', color:'#14b8a6', description:'易专属皮肤', boundCharacters:['yi'], motions:{idle:true,thinking:true,working:true,speaking:false,success:true,error:false}, portrait:true, avatar:true },
  { id:'ziwei', name:'紫微', color:'#d4a017', description:'紫微专属皮肤', boundCharacters:[], motions:{idle:true,thinking:false,working:true,speaking:true,success:false,error:false}, portrait:false, avatar:false },
  { id:'miku', name:'Miku', color:'#22d3ee', description:'初音未来风格共用皮肤', boundCharacters:[], motions:{idle:true,thinking:true,working:true,speaking:true,success:true,error:true}, portrait:false, avatar:false },
];
const TOOLS_META = ['bash','read','write','edit','glob','grep','webfetch','websearch','get_time','skill_manager','task_complete','character_manager','mcp'];
const SKIN_MOTIONS = ['idle','thinking','working','speaking','success','error'];
const MOTION_LABELS = { idle:'idle（待机）', thinking:'thinking（思考）', working:'working（工作）', speaking:'speaking（说话）', success:'success（完成）', error:'error（出错）' };
const ALL_SKILLS = ['content-writer','code-reviewer','pdf-toolkit','web-researcher','data-analyst'];

/* ===================== 工具函数 ===================== */
function roleLabel(r){ return r==='main'?'主 Agent':r==='sub'?'子 Agent':'主 / 子 Agent'; }
function getChar(){ return CHARACTERS.find(c=>c.id===state.charId) || CHARACTERS[0]; }
function getSkin(){ return SKINS.find(s=>s.id===state.skinId) || SKINS[0]; }
function getSkinName(id){ return (SKINS.find(s=>s.id===id)||{}).name || id; }
function charInitial(c){ return (c.name||'?').slice(0,1); }
function countMotions(s){ return Object.values(s.motions||{}).filter(Boolean).length; }
function timeAgo(ts){ if(!ts) return '--'; const d=Date.now()-ts; const m=Math.floor(d/60000); if(m<1) return '刚刚'; if(m<60) return m+' 分钟前'; const h=Math.floor(m/60); if(h<24) return h+' 小时前'; return Math.floor(h/24)+' 天前'; }
function toast(msg){ let t=$('toast'); if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),1600); }

/* ===================== 渲染：骨架 ===================== */
function renderCrumb(){
  if(state.section==='skin'){ const s=getSkin(); $('crumb').innerHTML = `皮肤 · <b>${esc(s.name)}</b>`; }
  else { const c=getChar(); $('crumb').innerHTML = `角色 · <b>${esc(c.name)}</b>`; }
}
function renderSidebar(){
  const sb=$('sidebar');
  if(state.section==='skin'){
    sb.innerHTML = `<div class="side-head"><span class="side-title">皮肤</span><button class="icon-btn" data-act="skin:create" title="新建皮肤"><span id="ic-add2"></span></button></div>
      <div class="kb-list">${SKINS.map(s=>`
        <div class="kb-card ${s.id===state.skinId?'active':''}" data-act="skin:select:${s.id}">
          <div class="kb-avatar" style="background:${s.color}">${esc(charInitial(s))}</div>
          <div class="kb-name">${esc(s.name)}</div>
          <div class="kb-desc">${esc(s.id)} · ${countMotions(s)}/6 动画</div>
          <div class="kb-meta">${s.boundCharacters&&s.boundCharacters.length?`<span class="stat-pill">${s.boundCharacters.length} 角色使用</span>`:`<span class="stat-pill" style="opacity:.6">未绑定</span>`}</div>
        </div>`).join('')}</div>`;
  } else {
    sb.innerHTML = `<div class="side-head"><span class="side-title">角色</span><button class="icon-btn" data-act="char:create" title="新建角色"><span id="ic-add2b"></span></button></div>
      <div class="kb-list">${CHARACTERS.map(c=>`
        <div class="kb-card ${c.id===state.charId?'active':''}" data-act="char:select:${c.id}">
          <div class="kb-avatar" style="background:${c.color}">${esc(charInitial(c))}</div>
          <div class="kb-name">${esc(c.name)}</div>
          <div class="kb-desc">${esc(roleLabel(c.role))} · ${c.enabled?'启用':'停用'}</div>
          <div class="kb-meta">${c.skinId?`<span class="stat-pill">皮肤 ${esc(c.skinId)}</span>`:`<span class="stat-pill" style="opacity:.6">默认皮肤</span>`}</div>
        </div>`).join('')}</div>`;
  }
  const a=document.getElementById('ic-add2')||document.getElementById('ic-add2b'); if(a) a.innerHTML=ic('add',15);
}
function renderBody(){
  const d=$('detail');
  if(state.section==='skin') d.innerHTML = renderSkinDetail();
  else d.innerHTML = renderCharacterDetail();
}

/* ===================== 渲染：角色详情 ===================== */
function renderCharacterDetail(){
  const c=getChar();
  const tabs=[['basic','基础'],['visual','视觉与动画'],['memory','记忆'],['tools','工具'],['skills','技能'],['stats','统计']];
  return `<div class="detail-wrap">
    <div class="detail-head">
      <div class="detail-avatar" style="background:${c.color}">${esc(charInitial(c))}</div>
      <div class="detail-headinfo">
        <div class="detail-name">${esc(c.name)} <span class="tag">${esc(c.id)}</span></div>
        <div class="detail-sub">${esc(roleLabel(c.role))} · ${c.enabled?'<span style="color:var(--success)">已启用</span>':'<span style="color:var(--danger)">已停用</span>'} · 分组 ${esc((c.groups||[]).join(' / ')||'—')}</div>
      </div>
      <div style="flex:1"></div>
      <label class="switch"><input type="checkbox" data-act="char:enabled" ${c.enabled?'checked':''}><span class="slider"></span></label>
      <button class="btn" data-act="char:edit-skin">${ic('link',14)} 绑定皮肤</button>
    </div>
    <div class="tabs" id="charTabs">${tabs.map(([k,l])=>`<div class="tab ${k===state.charTab?'active':''}" data-act="char:tab:${k}">${l}</div>`).join('')}</div>
    <div class="tab-body">${renderCharTab(c)}</div>
  </div>`;
}
function renderCharTab(c){
  if(state.charTab==='basic') return renderCharBasic(c);
  if(state.charTab==='visual') return renderCharVisual(c);
  if(state.charTab==='memory') return renderCharMemory(c);
  if(state.charTab==='tools') return renderCharTools(c);
  if(state.charTab==='skills') return renderCharSkills(c);
  if(state.charTab==='stats') return renderCharStats(c);
  return '';
}
function renderCharBasic(c){
  return `<div class="form-grid">
    <div class="field"><label>名称</label><input type="text" data-charfield="name" value="${esc(c.name)}"></div>
    <div class="field"><label>角色 ID（创建后不可改）</label><input type="text" value="${esc(c.id)}" disabled style="opacity:.7"></div>
    <div class="field" style="grid-column:1/-1"><label>描述</label><textarea data-charfield="description">${esc(c.description||'')}</textarea></div>
    <div class="field"><label>主题色</label><input type="color" data-charfield="color" value="${esc(c.color)}"></div>
    <div class="field"><label>角色类型</label><select data-charfield="role"><option value="main" ${c.role==='main'?'selected':''}>主 Agent</option><option value="sub" ${c.role==='sub'?'selected':''}>子 Agent</option><option value="both" ${c.role==='both'?'selected':''}>主 / 子 Agent</option></select></div>
    <div class="field"><label>默认策略</label><select data-charfield="default_strategy"><option ${c.default_strategy==='Off'?'selected':''}>Off</option><option ${c.default_strategy==='Read Only'?'selected':''}>Read Only</option><option ${c.default_strategy==='Review'?'selected':''}>Review</option><option ${c.default_strategy==='Auto Approve'?'selected':''}>Auto Approve</option></select></div>
    <div class="field" style="grid-column:1/-1"><label>分组</label><div class="chips">${(c.groups||[]).map(g=>`<span class="chip">${esc(g)} <button data-act="char:group:remove:${g}">×</button></span>`).join('')}<input class="chip-input" placeholder="输入后回车" data-act="char:group:add"></div></div>
    <div class="field" style="grid-column:1/-1"><label>Soul（角色灵魂）</label><textarea data-charfield="soul" style="min-height:88px">${esc(c.soul||'')}</textarea></div>
    <div class="field" style="grid-column:1/-1"><label>用户画像 userProfile</label><textarea data-charfield="userProfile" style="min-height:64px">${esc(c.userProfile||'')}</textarea></div>
    <div class="field" style="grid-column:1/-1"><label>记忆内容 memoryContent</label><textarea data-charfield="memoryContent" style="min-height:64px">${esc(c.memoryContent||'')}</textarea></div>
    <div class="field"><label>记忆开关</label><label class="switch"><input type="checkbox" data-charfield="memEnabled" ${c.memory&&c.memory.enabled?'checked':''}><span class="slider"></span></label></div>
    <div class="field"><label>记忆上限 charLimit</label><input type="number" data-charfield="charLimit" value="${c.memory?c.memory.charLimit:2000}" style="width:120px"></div>
    <div class="field" style="grid-column:1/-1"><button class="btn primary" data-act="char:save">保存修改</button><span class="hint" style="margin-left:10px">演示：修改即时写入内存态，刷新页面后还原</span></div>
  </div>`;
}
function renderCharVisual(c){
  const activeId=c.skinId||'';
  return `<div class="detail-section">
    <div class="section-title">${ic('link',14)} 绑定皮肤</div>
    <div class="visual-slot-file">${activeId?`已激活：<b>${esc(getSkinName(activeId))}</b>`:`未激活皮肤 · 默认展示同名皮肤 <b>${esc(c.id)}</b>`}</div>
    <div class="skin-binder">${SKINS.map(s=>{
      const isActive=activeId===s.id; const isDefault=!activeId&&s.id===c.id;
      return `<div class="skin-card ${isActive?'active':''}">
        <div class="skin-card-avatar" style="background:${s.color}">${esc(charInitial(s))}</div>
        <div class="skin-card-name">${esc(s.name)}</div>
        <div class="skin-card-desc">${esc(s.id)}</div>
        <div class="skin-foot">${isActive?`<button class="btn sm" data-act="skin:deactivate" style="color:var(--danger)">取消激活</button>`:`<button class="btn sm primary" data-act="skin:activate:${s.id}">激活</button>`}</div>
      </div>`;
    }).join('')}</div>
  </div>`;
}
function renderCharMemory(c){
  const mem=MEMORIES[c.id];
  if(!mem){ return `<div class="empty" style="padding:30px">该角色暂无记忆演示数据（演示记忆仅「小枢」）。切到「小枢」查看完整记忆浏览器 / 绑定与权限 / 审计。</div>`; }
  const tabs=[['overview','概览'],['browser','记忆浏览器'],['binding','绑定与权限'],['audit','审计']];
  let body;
  if(state.memTab==='overview') body=renderMemOverview();
  else if(state.memTab==='browser') body=renderMemBrowser();
  else if(state.memTab==='binding') body=renderMemBinding();
  else if(state.memTab==='audit') body=renderMemAudit();
  return `<div class="nested-tabs">${tabs.map(([k,l])=>`<div class="tab sm ${k===state.memTab?'active':''}" data-act="mem:tab:${k}">${l}</div>`).join('')}</div>${body}`;
}
function renderCharTools(c){
  const bound=new Set((c.tools||[]).map(t=>t.name));
  return `<div class="detail-section"><div class="section-title">${ic('tool',14)} 已绑定工具（${bound.size}）</div>
    <div class="tool-grid">${TOOLS_META.map(name=>{
      const on=bound.has(name);
      return `<div class="tool-row"><span class="tool-name">${esc(name)}</span>
        <label class="switch"><input type="checkbox" data-act="tool:toggle:${name}" ${on?'checked':''}><span class="slider"></span></label></div>`;
    }).join('')}</div></div>`;
}
function renderCharSkills(c){
  const bound=(c.skillBindings||c.skills||[]).map(x=>typeof x==='string'?x:x.packageId);
  const unbound=ALL_SKILLS.filter(s=>!bound.includes(s));
  return `<div class="detail-section"><div class="section-title">已绑定技能包（${bound.length}）</div>
    <div class="chip-list">${bound.map(s=>`<span class="chip">${esc(s)} <button data-act="skill:remove:${s}">×</button></span>`).join('')||'<span class="muted">暂无</span>'}</div>
    <div class="section-title" style="margin-top:14px">可绑定</div>
    <div class="chip-list">${unbound.map(s=>`<span class="chip dashed" data-act="skill:add:${s}">+ ${esc(s)}</span>`).join('')||'<span class="muted">已全部绑定</span>'}</div>
  </div>`;
}
function renderCharStats(c){
  const st=c.stats||{};
  return `<div class="detail-section"><div class="section-title">使用概览</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kv">${st.sessionCount??'--'}</div><div class="kl">会话数</div></div>
      <div class="kpi"><div class="kv">--</div><div class="kl">成功率</div></div>
      <div class="kpi"><div class="kv">${timeAgo(st.lastActive)}</div><div class="kl">最近活跃</div></div>
    </div>
    <div class="detail-section" style="margin-top:14px"><div class="section-title">调用趋势</div><div class="empty">需要后端打点后展示</div></div>
  </div>`;
}

/* ===================== 渲染：皮肤详情 ===================== */
function uploadBtn(slot){ return `<label class="btn sm" style="margin-top:6px">上传<input type="file" accept="image/*,video/*" hidden data-upload="${slot}"></label>`; }
function renderSkinDetail(){
  const s=getSkin();
  const pv=state.skinPreview[s.id]||{};
  const slot=(url,label,kind)=> url
    ? (kind==='video'?`<video src="${url}" autoplay muted loop playsinline></video>`:`<img src="${url}">`)
    : `<span class="visual-slot-empty">${esc(label)}</span>`;
  return `<div class="detail-wrap">
    <div class="detail-head">
      <div class="detail-avatar" style="background:${s.color}">${esc(charInitial(s))}</div>
      <div class="detail-headinfo">
        <div class="detail-name">${esc(s.name)} <span class="tag">${esc(s.id)}</span></div>
        <div class="detail-sub">${s.boundCharacters&&s.boundCharacters.length?`${s.boundCharacters.length} 个角色使用`:'未绑定角色'}</div>
      </div>
      <div style="flex:1"></div>
      <button class="btn" data-act="skin:delete" style="color:var(--danger)">删除皮肤</button>
    </div>
    <div class="skin-editor">
      <div class="skin-left">
        <div class="visual-slot portrait">
          <div class="vs-preview">${slot(pv.portrait,'立绘')}</div>
          <div class="vs-name">立绘 (portrait)</div>
          ${uploadBtn('portrait')}
        </div>
        <div class="visual-slot original">
          <div class="vs-preview">${slot(pv.original,'原画')}</div>
          <div class="vs-name">原画 (original)</div>
          ${uploadBtn('original')}
        </div>
      </div>
      <div class="skin-right">
        <div class="visual-slot avatar">
          <div class="vs-preview lg">${slot(pv.avatar,'头像')}</div>
          <div class="vs-name">头像 (avatar)</div>
          ${uploadBtn('avatar')}
        </div>
        <div class="animations">
          ${SKIN_MOTIONS.map(m=>`
            <div class="visual-slot motion">
              <div class="vs-preview">${slot(pv[m], MOTION_LABELS[m]||m, 'video')}</div>
              <div class="vs-name">${MOTION_LABELS[m]||m}</div>
              ${uploadBtn(m)}
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="hint" style="margin-top:12px">演示：点击「上传」选择本地图片/视频，仅前端预览，不落盘。</div>
  </div>`;
}

/* ===================== 事件 ===================== */
document.addEventListener('click', e=>{
  const t=e.target.closest('[data-act]'); if(!t) return;
  const [act,...rest]=t.dataset.act.split(':');
  const a1=rest[0], a2=rest[1], aRest=rest.slice(1).join(':');
  if(act==='section'){ state.section=a1; render(); }
  else if(act==='char'){
    if(a1==='select'){ state.charId=a2; state.memChar=a2; state.charTab='basic'; render(); }
    else if(a1==='tab'){ state.charTab=a2; renderBody(); }
    else if(a1==='enabled'){ const c=getChar(); c.enabled=!c.enabled; renderBody(); }
    else if(a1==='edit-skin'){ state.charTab='visual'; renderBody(); }
    else if(a1==='save'){ toast('已保存（演示）'); }
    else if(a1==='create'){ toast('演示：弹出新建角色对话框'); }
    else if(a1==='group'){
      if(a2==='add'){ const inp=t.previousElementSibling; const v=(inp.value||'').trim(); if(v){ const c=getChar(); c.groups=c.groups||[]; if(!c.groups.includes(v)) c.groups.push(v); renderBody(); } }
      else if(a2==='remove'){ const c=getChar(); const g=aRest; c.groups=(c.groups||[]).filter(x=>x!==g); renderBody(); }
    }
  }
  else if(act==='skin'){
    if(a1==='select'){ state.skinId=a2; render(); }
    else if(a1==='activate'){ const c=getChar(); c.skinId=a2; renderBody(); }
    else if(a1==='deactivate'){ const c=getChar(); c.skinId=null; renderBody(); }
    else if(a1==='delete'){ toast('演示：删除皮肤'); }
    else if(a1==='create'){ toast('演示：弹出新建皮肤对话框'); }
  }
  else if(act==='tool'){ if(a1==='toggle'){ const name=a2; const c=getChar(); const set=new Set((c.tools||[]).map(x=>x.name)); if(set.has(name)) c.tools=c.tools.filter(x=>x.name!==name); else c.tools.push({name}); renderBody(); } }
  else if(act==='skill'){ const name=a2; const c=getChar(); const arr=c.skillBindings||c.skills||[]; if(a1==='add'){ if(!arr.includes(name)) arr.push(name); } else { const i=arr.indexOf(name); if(i>=0) arr.splice(i,1); } if(c.skillBindings) c.skillBindings=arr; else c.skills=arr; renderBody(); }
  else if(act==='mem'){
    if(a1==='char'){ state.memChar=a2; state.charId=a2; state.memFilter='all'; render(); }
    else if(a1==='tab'){ state.memTab=a2; renderBody(); }
    else if(a1==='filter'){ state.memFilter=a2; renderBody(); }
    else if(a1==='act'){
      const [sub,mid]=rest.slice(1); const m=MEMORIES[state.memChar]; if(!m) return; const x=m.l1.find(z=>z.id===mid); if(!x) return;
      if(sub==='approve'){ x.status='active'; x.note='已由用户批准，进入稳定 Snapshot。'; }
      else if(sub==='resolve'){ x.status='active'; x.conflictWith=null; x.note='用户已解决冲突，采纳新结论。'; }
      else if(sub==='forget'){ m.l1=m.l1.filter(z=>z.id!==mid); }
      else if(sub==='visibility'){ const order=['private','group','user']; x.visibility=order[(order.indexOf(x.visibility)+1)%3]; }
      else if(sub==='edit'){ openMemEdit(mid); return; }
      renderBody();
    }
    else if(a1==='save'){ const id=$('memModal').dataset.id; const x=MEMORIES[state.memChar].l1.find(z=>z.id===id); if(x){ x.subject=$('memEditSubject').value; x.content=$('memEditContent').value; x.visibility=$('memEditVis').value; } $('memModal').classList.remove('show'); renderBody(); }
  }
  else if(act==='memmodal'){ $('memModal').classList.remove('show'); }
  else if(act==='theme'){ const r=document.documentElement; r.dataset.theme=r.dataset.theme==='dark'?'light':'dark'; }
});

function openMemEdit(id){
  const m=MEMORIES[state.memChar]; if(!m) return;
  const x=m.l1.find(z=>z.id===id); if(!x) return;
  $('memEditSubject').value=x.subject||'';
  $('memEditContent').value=x.content||'';
  $('memEditVis').value=x.visibility||'private';
  $('memModal').dataset.id=id;
  $('memModal').classList.add('show');
}
document.addEventListener('change', e=>{
  const up=e.target.closest('[data-upload]');
  if(up){ const slot=up.dataset.upload; const f=up.files&&up.files[0]; if(f){ const url=URL.createObjectURL(f); state.skinPreview[state.skinId]=state.skinPreview[state.skinId]||{}; state.skinPreview[state.skinId][slot]=url; renderBody(); } return; }
  const cf=e.target.closest('[data-charfield]');
  if(cf){ const k=cf.dataset.charfield; const c=getChar();
    if(k==='name') c.name=cf.value;
    else if(k==='description') c.description=cf.value;
    else if(k==='color'){ c.color=cf.value; renderBody(); }
    else if(k==='role'){ c.role=cf.value; renderBody(); }
    else if(k==='default_strategy'){ c.default_strategy=cf.value; }
    else if(k==='soul') c.soul=cf.value;
    else if(k==='userProfile') c.userProfile=cf.value;
    else if(k==='memoryContent') c.memoryContent=cf.value;
    else if(k==='memEnabled'){ c.memory=c.memory||{}; c.memory.enabled=cf.checked; }
    else if(k==='charLimit'){ c.memory=c.memory||{}; c.memory.charLimit=+cf.value; }
    return;
  }
  const lo=e.target.closest('[data-loadout]'); if(lo){ const row=(LOADOUT[state.memChar]||[]).find(t=>t.tool===lo.dataset.loadout); if(row) row.on=lo.checked; }
});
$('memModal').addEventListener('click', e=>{ if(e.target.id==='memModal') $('memModal').classList.remove('show'); });

function render(){
  document.querySelectorAll('#sectionSwitch button').forEach(b=>b.classList.toggle('active', b.dataset.act===`section:${state.section}`));
  renderCrumb(); renderSidebar(); renderBody();
}
render();
