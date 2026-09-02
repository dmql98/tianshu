// 一次性脚本：把 nomifun-vs-tianshu-对比与优化方案.md 转成单文件 HTML（现代深色技术报告风格）
import { readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
// markdown-it 存在于 web/client/node_modules，用其作为解析基点
const require = createRequire(import.meta.url.replace('docs/build-compare-html.mjs', 'web/client/node_modules/markdown-it/package.json'))
const mdIt = require('markdown-it')
const path = require('path')

const mdPath = path.resolve('docs/nomifun-vs-tianshu-对比与优化方案.md')
const outPath = path.resolve('docs/nomifun-vs-tianshu-对比与优化方案.html')
const src = readFileSync(mdPath, 'utf8')

// ---- 收集标题构建 TOC（h2/h3）----
const toc = []
for (const line of src.split('\n')) {
  const m = /^(#{2,3})\s+(.*)$/.exec(line)
  if (m) {
    const level = m[1].length
    const title = m[2].replace(/[*`]/g, '').trim()
    const id = slugify(title)
    toc.push({ level, title, id })
  }
}

function slugify(raw) {
  return raw
    .replace(/\s*[（(].*?[)）]\s*$/, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ---- markdown-it 渲染（锚点注入）----
const md = new mdIt({ html: true, linkify: true, breaks: false })
const seen = new Map()
md.renderer.rules.heading_open = (tokens, idx) => {
  const tok = tokens[idx]
  // markdown-it 的 heading token 自身 content 为空，标题文本在紧随其后的 inline token
  const inline = tokens[idx + 1]
  const raw = (inline && inline.type === 'inline' ? inline.content : '').replace(/[*`]/g, '').trim()

  let slug = slugify(raw)
  const n = (seen.get(slug) || 0) + 1
  seen.set(slug, n)
  if (n > 1) slug = slug + '-' + n
  tok.attrSet('id', slug)
  return '<h' + tok.tag.slice(1) + ' id="' + slug + '">'
}
md.renderer.rules.heading_close = (tokens, idx) => '</h' + tokens[idx].tag.slice(1) + '>'

let body = md.render(src)

// 给表格包容器类（横向滚动）
body = body.replace(/<table>/g, '<div class="tbl-wrap"><table>')
body = body.replace(/<\/table>/g, '</table></div>')
// blockquote 标注
body = body.replace(/<blockquote>\s*<p>⚠️/g, '<blockquote class="warn"><p>⚠️')

// ---- 侧栏 TOC HTML ----
function tocHtml(items) {
  let html = ''
  let open = false
  for (const it of items) {
    if (it.level === 2) {
      if (open) { html += '</ul>'; open = false }
      html += '<a class="toc-h2" href="#' + it.id + '">' + it.title + '</a>'
    } else {
      if (!open) { html += '<ul>'; open = true }
      html += '<li><a href="#' + it.id + '">' + it.title + '</a></li>'
    }
  }
  if (open) html += '</ul>'
  return html
}

// ---- 骨架 ----
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NomiFun vs 天枢 — 深度对比与优化方案</title>
<style>
  :root{
    --bg:#070b14; --panel:#0e1526;
    --line:#1e293b; --line2:#28364d;
    --text:#d7deea; --muted:#8b98ad; --dim:#5b6a80;
    --gold:#e8c878; --gold-soft:rgba(232,200,120,.1);
    --ts-blue:#7db4ff; --nf-pink:#ff7b9c;
    --amber:#f4c477;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Cascadia Code',monospace;
    --sans:ui-sans-serif,system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:radial-gradient(1200px 600px at 80% -10%,#12203f 0%,transparent 60%),#070b14;color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.75}
  a{color:var(--ts-blue);text-decoration:none}
  a:hover{text-decoration:underline}
  .wrap{display:grid;grid-template-columns:280px minmax(0,920px);gap:32px;max-width:1280px;margin:0 auto;padding:32px 28px 80px}
  aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:28px 6px 28px 0}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .brand .dot{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--gold),#b98a3a);display:grid;place-items:center;font-weight:800;color:#201708;font-size:15px}
  .brand b{font-size:16px;letter-spacing:.5px}
  .brand small{display:block;color:var(--dim);font-weight:400;font-size:11px;letter-spacing:1.5px}
  .toc-h2{display:block;margin:14px 0 4px;color:var(--text);font-weight:600;font-size:12.5px;letter-spacing:.3px}
  aside ul{list-style:none;margin:0;padding:0 0 0 10px;border-left:1px solid var(--line)}
  aside li{margin:2px 0}
  aside ul a{color:var(--muted);font-size:12px}
  aside ul a:hover{color:var(--gold)}
  .tagline{color:var(--dim);font-size:11.5px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
  main{min-width:0}
  .hero{padding:34px 0 26px;border-bottom:1px solid var(--line);margin-bottom:26px}
  .hero h1{margin:0 0 12px;font-size:30px;line-height:1.3;font-weight:800}
  .hero h1 em{font-style:normal;color:var(--nf-pink)}
  .hero .vs{color:var(--dim);padding:0 6px;font-size:22px}
  .hero .sub{color:var(--muted);font-size:14px;max-width:760px}
  .hero .sub b{color:var(--gold)}
  .badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
  .badge{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);color:var(--muted);background:var(--panel)}
  .badge b{color:var(--text);font-weight:600}
  .badge .nf{color:var(--nf-pink)} .badge .ts{color:var(--ts-blue)} .badge.gold{color:var(--gold)}
  .meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--dim);font-size:12px;margin-top:10px}
  h2{font-size:21px;font-weight:700;margin:44px 0 14px;padding:10px 0 10px 14px;border-left:3px solid var(--gold);background:linear-gradient(90deg,var(--gold-soft),transparent);border-radius:0 8px 8px 0}
  h3{font-size:16.5px;font-weight:700;margin:30px 0 10px;color:var(--gold)}
  h4{font-size:14.5px;margin:22px 0 8px;color:var(--ts-blue)}
  p{margin:10px 0}
  strong{color:#f0f4fa}
  ul,ol{padding-left:22px}
  li{margin:4px 0}
  code{font-family:var(--mono);font-size:12.5px;background:#1a2440;border:1px solid var(--line);padding:1px 6px;border-radius:5px;color:#ffd9a8}
  pre{background:#0d1220;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;overflow-x:auto;line-height:1.55}
  pre code{background:none;border:none;padding:0;color:#c9d6ec;font-size:12.5px}
  .tbl-wrap{overflow-x:auto;margin:12px 0;border:1px solid var(--line2);border-radius:10px}
  table{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}
  th{background:#16203a;color:var(--gold);font-weight:600;text-align:left;padding:9px 12px;white-space:nowrap}
  td{padding:8px 12px;border-top:1px solid var(--line);vertical-align:top}
  tbody tr:hover td{background:rgba(125,180,255,.04)}
  blockquote{border-left:3px solid var(--gold);margin:14px 0;padding:10px 16px;background:var(--gold-soft);border-radius:0 8px 8px 0;color:var(--muted)}
  blockquote.warn{border-left-color:var(--amber);background:rgba(244,196,119,.07)}
  blockquote p{margin:4px 0}
  hr{border:none;border-top:1px solid var(--line);margin:34px 0}
  @media(max-width:1000px){
    .wrap{grid-template-columns:1fr;padding:18px 14px 60px}
    aside{position:static;max-height:none;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:10px}
    aside ul{columns:2}
  }
  @media(max-width:640px){ aside ul{columns:1} }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <div class="brand"><div class="dot">枢</div><div><b>NomiFun × 天枢</b><small>对标研究与优化方案</small></div></div>
    <nav>
{{TOC}}
    </nav>
    <div class="tagline">数据来源：两仓库源码结构 / 架构文档 / Git 历史<br>生成：2026-09-04</div>
  </aside>
  <main>
    <div class="hero">
      <h1><em>NomiFun</em><span class="vs">VS</span>天枢 TianShu<br>深度对比与优化方案</h1>
      <div class="sub">从架构、功能矩阵到进化体系逐项对标，产出按 P0 / P1 / P2 分级的天枢优化路线图。核心结论：<b>补齐架构基础（数据层 / 锁 / 适配层），并把天枢已有的进化引擎从「半接线」做成「可见、可配、可干预」的专门页面。</b></div>
      <div class="badges">
        <span class="badge"><b>3,770</b> 提交 · <b class="nf">NomiFun</b> Rust 52 crates</span>
        <span class="badge"><b>190</b> 提交 · <b class="ts">天枢</b> Node TS</span>
        <span class="badge">对标：<b class="nf">EvolutionTab</b> / <b class="ts">evolution 半接线</b></span>
        <span class="badge gold">产出：3×P0 · 4×P1 · 5×P2</span>
      </div>
      <div class="meta">文档：dev/docs/nomifun-vs-tianshu-对比与优化方案.md · 由 markdown 自动转译</div>
    </div>
{{BODY}}
  </main>
</div>
</body>
</html>`

const out = html.replace('{{TOC}}', tocHtml(toc)).replace('{{BODY}}', body)
writeFileSync(outPath, out, 'utf8')
console.log('written ' + outPath + ' (' + (out.length / 1024).toFixed(1) + ' KB)')

