/**
 * 种子数据脚本：把市场 demo 的资产、分类、类型专属面板数据导入 SQLite。
 * 数据源统一以 index.html（首页）的资产为准，详情页只作为面板数据的补充。
 * 运行：npm run seed  （幂等；--reset 强制重建资产）
 */
const bcrypt = require('bcryptjs');
const { db } = require('./db');

// ─────────── 分类 ───────────
const CATS = [
  { key: 'character', name: '角色',   icon: 'fa-solid fa-user-astronaut',      grad: 'from-amber-500/80 to-orange-600/80', sort: 1 },
  { key: 'skin',      name: '皮肤',   icon: 'fa-solid fa-shirt',               grad: 'from-rose-500/80 to-pink-600/80',   sort: 2 },
  { key: 'skill',     name: '技能',   icon: 'fa-solid fa-wand-magic-sparkles', grad: 'from-emerald-500/80 to-teal-600/80', sort: 3 },
  { key: 'tool',      name: '工具',   icon: 'fa-solid fa-screwdriver-wrench',  grad: 'from-sky-500/80 to-blue-600/80',    sort: 4 },
  { key: 'mcp',       name: 'MCP',    icon: 'fa-solid fa-plug-circle-bolt',    grad: 'from-cyan-500/80 to-sky-600/80',    sort: 5 },
  { key: 'kb',        name: '知识库', icon: 'fa-solid fa-book-open',           grad: 'from-indigo-500/80 to-violet-600/80', sort: 6 },
  { key: 'theme',     name: '主题',   icon: 'fa-solid fa-palette',             grad: 'from-teal-500/80 to-emerald-600/80', sort: 7 },
  { key: 'iconpack',  name: '图标包', icon: 'fa-solid fa-icons',               grad: 'from-orange-500/80 to-amber-600/80', sort: 8 },
  { key: 'provider',  name: '提供商', icon: 'fa-solid fa-server',              grad: 'from-purple-500/80 to-indigo-600/80', sort: 9 },
  { key: 'prompt',    name: '提示词', icon: 'fa-solid fa-comment-dots',        grad: 'from-pink-500/80 to-rose-600/80',    sort: 10 },
];

// ─────────── 资产（以 index.html 首页为准，id 1-17） ───────────
// [id, cat, name, author, verified, dl, rate, ver, days, tags[], desc]
const ASSETS = [
  [1, 'character', '星轨架构师', '天枢官方', 1, 21400, 4.9, '2.3.0', 3, ['架构', '系统设计', '官方'], '内置分布式系统、容量规划与 ADR 决策方法论的系统设计专家角色。附赠 6 套架构评审技能，支持生成 C4 架构图与评审报告。'],
  [2, 'skill', '周报一键生成', '林小满', 0, 15800, 4.8, '1.4.2', 6, ['效率', '写作'], '读取你本周的 Git 提交、任务列表与日程，自动生成结构化周报，支持自定义模板与语气风格。'],
  [3, 'mcp', 'PostgreSQL 连接器', 'DevTools 社区', 1, 13200, 4.7, '3.1.0', 9, ['数据库', 'MCP'], '让 Agent 直接读写 PostgreSQL：Schema 感知、安全只读模式、慢查询分析一应俱全。'],
  [4, 'theme', '曜石黑 · Obsidian', '墨白', 0, 11600, 4.9, '1.2.0', 2, ['深色', '护眼'], '为深夜编码调校的纯黑主题，琥珀色强调，对比度通过 WCAG AAA 校验。'],
  [5, 'character', '面试陪练官', 'HR 研习社', 0, 9800, 4.6, '1.8.1', 12, ['求职', '模拟面试'], '覆盖行为面、技术面、系统设计面的全真模拟面试官，结束后给出逐题复盘与改进建议。'],
  [6, 'kb', 'Vue3 源码知识库', '前端茶馆', 1, 8700, 4.8, '2.0.0', 15, ['前端', '源码'], 'Vue3 响应式系统、编译器、运行时全链路源码精读笔记，含 200+ 张流程图，检索命中率 95%。'],
  [7, 'tool', 'JSON 差异对比', 'DevTools 社区', 1, 7600, 4.5, '1.1.0', 20, ['开发', '调试'], '两个 JSON 文档的深度 diff 工具，支持路径定位、忽略键序、导出补丁。Agent 调试配置必备。'],
  [8, 'iconpack', '线条宇宙 · Line Cosmos', '墨白', 0, 6900, 4.7, '1.0.3', 5, ['线性', '极简'], '420 枚 1.5px 线性图标，覆盖 Agent 场景全部分类，含暗色/亮色两套适配。'],
  [9, 'skin', '磨砂星云皮肤', '拾光', 0, 6300, 4.4, '1.3.0', 8, ['毛玻璃', '浅色'], '全局毛玻璃质感皮肤，侧边栏半透明星云纹理，支持跟随系统浅色/深色切换。'],
  [10, 'skill', '论文速读', '学术喵', 0, 5900, 4.6, '1.5.0', 11, ['科研', '阅读'], '投喂 PDF 论文，3 分钟输出核心贡献、方法图解与局限性分析，支持 arXiv 链接直读。'],
  [11, 'mcp', '本地文件管家 MCP', '天枢官方', 1, 5600, 4.8, '2.2.1', 4, ['文件', '官方'], '授予 Agent 安全的本地文件读写能力：沙箱目录、操作审计日志、危险操作二次确认。'],
  [12, 'character', '小红书写手', '林小满', 0, 5200, 4.3, '1.2.4', 18, ['营销', '文案'], '深谙小红书流量密码的种草文案角色，标题党指数可调，自带 emoji 排版美学。'],
  [13, 'kb', '大模型提示词工程', '天枢官方', 1, 4900, 4.9, '3.0.0', 7, ['Prompt', '官方'], '300+ 条经过实测的提示词模式库，覆盖角色设定、思维链、结构化输出等九大场景。'],
  [14, 'tool', 'API Mock 工作台', 'DevTools 社区', 1, 4100, 4.5, '1.0.8', 14, ['开发', '测试'], '按 OpenAPI 描述一键生成 Mock 服务，支持随机数据规则、延迟注入与异常模拟。'],
  [15, 'theme', '晨雾白 · Mist', '拾光', 0, 3800, 4.6, '1.1.2', 10, ['浅色', '极简'], '低饱和暖灰浅色主题，长时间阅读不刺眼，代码区独立配色。'],
  [16, 'iconpack', '像素星球 · Pixel Planet', '像素工坊', 0, 2900, 4.4, '1.0.1', 16, ['像素', '复古'], '260 枚 16×16 像素风图标，复古游戏质感，让桌面端秒变掌机。'],
  [17, 'prompt', '系统提示词模板库', '天枢官方', 1, 8200, 4.7, '2.1.0', 5, ['提示词', '官方'], '50+ 条经过实测的系统提示词模板，覆盖编程、写作、分析、创意等场景。'],
];

// ─────────── 类型专属面板数据（来自详情页，按资产名匹配） ───────────
const EXTRA_BY_NAME = {
  '星轨架构师': {
    characterData: {
      tools: ['bash','read','write','edit','glob','grep','webfetch','websearch','get_time','skill_manager','task_complete','mcp:codegraph'],
      skills: ['graphify','agent-reach'],
      maxSteps: 999, strategy: 'Auto Approve',
      soul: '你是一个专业的系统架构师，擅长分布式系统设计和容量规划。你能帮助团队进行架构评审、技术选型，并生成标准化的架构文档。',
      visual: { avatar:'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80', portrait:'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=400&q=80' }
    }
  },
  '线条宇宙 · Line Cosmos': {
    iconpackData: {
      slotCount:420, previewIcons:['add','archived','attach','close','copy','delete','error','export','file','folder','goal','home','image','info','menu','more'],
      slots:{ add:{file:'add.svg',tint:true}, close:{file:'close.svg',tint:true}, delete:{file:'delete.svg',tint:true}, home:{file:'home.svg',tint:true}, search:{file:'search.svg',tint:true}, settings:{file:'settings.svg',tint:true} }
    }
  },
  '曜石黑 · Obsidian': {
    themeData: {
      appearance:'dark',
      colors:{ primary:'#f59e0b', background:'#09090b', surface:'#1c1c21', surfaceLight:'#26262d', text:'#fafafa', textSecondary:'#a1a1aa', border:'#27272a', borderLight:'#3f3f46', success:'#10b981', warning:'#f59e0b', error:'#ef4444', info:'#3b82f6' },
      artwork:'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1200&q=80'
    }
  },
  '晨雾白 · Mist': {
    themeData: {
      appearance:'light',
      colors:{ primary:'#d97706', background:'#fafaf9', surface:'#ffffff', surfaceLight:'#f5f5f4', text:'#1c1917', textSecondary:'#78716c', border:'#e7e5e4', borderLight:'#d6d3d1', success:'#16a34a', warning:'#d97706', error:'#dc2626', info:'#2563eb' },
      artwork:'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=1200&q=80'
    }
  },
  'PostgreSQL 连接器': {
    mcpData: { command:'node', args:['postgresql-server.js'], capabilities:['tools','resources'], tools:['query','schema-info','slow-queries','explain'], status:'stable' }
  },
  '本地文件管家 MCP': {
    mcpData: { command:'node', args:['file-manager.js'], capabilities:['tools','resources'], tools:['read','write','list','search','watch'], status:'stable' }
  },
  'JSON 差异对比': {
    toolData: { format:'cli', size:'12KB' }
  },
  '像素星球 · Pixel Planet': {
    iconpackData: { slotCount:260, previewIcons:['add','close','delete','home','file','folder'], slots:{} }
  },
};

// ─────────── 关联资产（parentId -> items） ───────────
const RELS = {
  1: [
    { cat: 'skin',  name: '曜石黑 · Obsidian 皮肤', ver: '1.2.0', ref: 4 },
    { cat: 'skill', name: '架构评审 · ADR 决策助手', ver: '1.4.0', rid: 102 },
    { cat: 'skill', name: '容量规划计算器',          ver: '1.1.0', rid: 103 },
    { cat: 'skill', name: 'C4 架构图生成',           ver: '2.2.0', rid: 104 },
    { cat: 'skill', name: '技术选型对比分析',        ver: '1.0.3', rid: 105 },
    { cat: 'skill', name: '架构腐化检测',            ver: '0.9.2', rid: 106 },
    { cat: 'skill', name: '分布式事务方案库',         ver: '1.3.1', rid: 107 },
    { cat: 'kb',    name: '分布式系统设计模式知识库',  ver: '1.1.0', rid: 108 },
    { cat: 'mcp',   name: '本地文件管家 MCP',         ver: '2.2.1', ref: 11 },
  ],
  2: [
    { cat: 'skill', name: '周报模板库（12 套）', ver: '1.1.0', rid: 117 },
    { cat: 'mcp',   name: '本地文件管家 MCP',   ver: '2.2.1', ref: 11 },
  ],
  3: [
    { cat: 'tool', name: 'JSON 差异对比',          ver: '1.1.0', ref: 7 },
    { cat: 'mcp',  name: '慢查询采样分析器',       ver: '0.8.0', rid: 113 },
  ],
  4: [
    { cat: 'theme', name: '晨雾白 · Mist',   ver: '1.1.2', ref: 15 },
    { cat: 'skin',  name: '磨砂星云皮肤',     ver: '1.3.0', ref: 9 },
  ],
  5: [
    { cat: 'skin',  name: '职场正装 · 专属皮肤',  ver: '1.0.0', rid: 109 },
    { cat: 'skill', name: '简历诊断与优化',      ver: '2.1.0', rid: 110 },
    { cat: 'skill', name: '面试复盘报告生成',    ver: '1.3.0', rid: 111 },
    { cat: 'kb',    name: '高频面试题库 500 题', ver: '3.0.0', rid: 112 },
  ],
  8: [
    { cat: 'iconpack', name: '像素星球 · Pixel Planet', ver: '1.0.1', ref: 16 },
  ],
  11: [
    { cat: 'mcp', name: 'PostgreSQL 连接器', ver: '3.1.0', ref: 3 },
  ],
  12: [
    { cat: 'skin',  name: '马卡龙 · 浅色皮肤', ver: '1.1.0', rid: 114 },
    { cat: 'skill', name: '爆款标题生成器',    ver: '2.0.0', rid: 115 },
    { cat: 'kb',    name: '种草文案案例库',    ver: '1.4.0', rid: 116 },
  ],
};

function seed() {
  // 分类
  const insCat = db.prepare(`INSERT OR REPLACE INTO categories (key,name,icon,grad,enabled,sort)
    VALUES (@key,@name,@icon,@grad,1,@sort)`);
  for (const c of CATS) insCat.run(c);

  const count = db.prepare('SELECT COUNT(*) AS c FROM assets').get().c;
  if (process.argv.includes('--reset') || count === 0) {
    db.exec('DELETE FROM user_installs; DELETE FROM user_favs; DELETE FROM related_assets; DELETE FROM assets;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('assets','related_assets')");
  } else {
    console.log(`数据库已有 ${count} 条资产，跳过重新导入（如需重置请运行 npm run seed -- --reset）`);
  }

  const insAsset = db.prepare(`INSERT INTO assets
    (id,name,cat,author,verified,dl,rate,ver,days,tags,desc,detail_data,status,created_at,updated_at)
    VALUES (@id,@name,@cat,@author,@verified,@dl,@rate,@ver,@days,@tags,@desc,@detail,'live',
            datetime('now','localtime', '-' || @days || ' days'), datetime('now','localtime'))`);

  const insRel = db.prepare(`INSERT INTO related_assets (parent_id,cat,name,ver,ref,rid)
    VALUES (@parent_id,@cat,@name,@ver,@ref,@rid)`);

  let inserted = 0, extraCount = 0;
  for (const [id, cat, name, author, verified, dl, rate, ver, days, tags, desc] of ASSETS) {
    const extra = EXTRA_BY_NAME[name] || {};
    if (Object.keys(extra).length) extraCount++;
    insAsset.run({
      id, cat, name, author, verified, dl, rate, ver, days,
      tags: JSON.stringify(tags), desc,
      detail: JSON.stringify(extra),
    });
    for (const r of (RELS[id] || [])) {
      insRel.run({ parent_id: id, cat: r.cat, name: r.name, ver: r.ver, ref: r.ref || null, rid: r.rid || null });
    }
    inserted++;
  }

  // 默认用户（唯一：admin + 示例普通用户）
  const hasUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (hasUser === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const userHash = bcrypt.hashSync('user123', 10);
    db.prepare(`INSERT INTO users (name,email,password_hash,avatar,role,installed)
      VALUES (?,?,?,?,?,?)`).run(
      '管理员', 'admin@tianshu.dev', adminHash,
      'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80', 'admin', 0);
    db.prepare(`INSERT INTO users (name,email,password_hash,avatar,role,installed)
      VALUES (?,?,?,?,?,?)`).run(
      '观星者', 'user@tianshu.dev', userHash,
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=80&q=80', 'user', 3);
    const uid = db.prepare(`SELECT id FROM users WHERE email='user@tianshu.dev'`).get().id;
    for (const aid of [4, 6, 11]) db.prepare(`INSERT OR IGNORE INTO user_installs (user_id,asset_id,version) VALUES (?,?,?)`).run(uid, aid, '1.0.0');
    for (const aid of [1, 4, 13]) db.prepare(`INSERT OR IGNORE INTO user_favs (user_id,asset_id) VALUES (?,?)`).run(uid, aid);
    db.prepare(`UPDATE users SET installed=3 WHERE id=?`).run(uid);
  }

  const relCount = db.prepare('SELECT COUNT(*) c FROM related_assets').get().c;
  console.log(`种子完成：${inserted} 个资产（含类型面板 ${extraCount} 个）、${relCount} 条关联、${db.prepare('SELECT COUNT(*) c FROM categories').get().c} 个分类。`);
  console.log('默认账号：admin@tianshu.dev / admin123（管理员），user@tianshu.dev / user123（普通用户）');
}

seed();