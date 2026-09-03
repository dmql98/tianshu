#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""md2html: 把天枢 markdown 文档转成与既有 docs 同风格的深色 HTML（带左侧 TOC）。"""
import re, sys, html

# ---------- 模板（与 docs/nomifun-vs-tianshu-对比与优化方案.html 同一套视觉语言） ----------
CSS = """
:root{
  --bg:#070b14; --panel:#0e1526;
  --line:#1e293b; --line2:#28364d;
  --text:#d7deea; --muted:#8b98ad; --dim:#5b6a80;
  --gold:#e8c878; --gold-soft:rgba(232,200,120,.1);
  --ts-blue:#7db4ff; --green:#7bd88f; --red:#ff7b7b; --amber:#f4c477;
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
.hero h1 em{font-style:normal;color:var(--gold)}
.hero .sub{color:var(--muted);font-size:14px;max-width:780px}
.hero .sub b{color:var(--gold)}
.badges{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.badge{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);color:var(--muted);background:var(--panel)}
.badge b{color:var(--text);font-weight:600}
.badge .p0{color:var(--red)} .badge .p1{color:var(--amber)} .badge.gold{color:var(--gold)} .badge .grn{color:var(--green)}
.meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--dim);font-size:12px;margin-top:10px}
h1.doc{margin:0 0 12px;font-size:24px;line-height:1.35}
h2{font-size:21px;font-weight:700;margin:44px 0 14px;padding:10px 0 10px 14px;border-left:3px solid var(--gold);background:linear-gradient(90deg,var(--gold-soft),transparent);border-radius:0 8px 8px 0}
h3{font-size:16.5px;font-weight:700;margin:30px 0 10px;color:var(--gold)}
h4{font-size:14.5px;margin:22px 0 8px;color:var(--ts-blue)}
p{margin:10px 0}
strong{color:#f0f4fa}
ul,ol{padding-left:22px}
li{margin:4px 0}
li.todo{list-style:none;margin-left:-18px}
li.todo .box{display:inline-block;width:13px;height:13px;border:1.5px solid var(--gold);border-radius:3px;margin-right:8px;vertical-align:-1px}
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
.milestones{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.ms{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:10px 12px}
.ms .k{color:var(--gold);font-weight:700;font-size:14px}
.ms .t{font-size:12.5px;color:var(--muted)}
.ms .d{font-size:11px;color:var(--dim);margin-top:2px}
.ms .chip{display:inline-block;font-size:10.5px;border-radius:999px;padding:1px 8px;border:1px solid var(--line2);color:var(--muted);margin-top:4px}
.chip.p0{color:var(--red);border-color:rgba(255,123,123,.4)}
.chip.p1{color:var(--amber);border-color:rgba(244,196,119,.4)}
.chip.dep{color:var(--ts-blue);border-color:rgba(125,180,255,.4)}
@media(max-width:1000px){
  .wrap{grid-template-columns:1fr;padding:18px 14px 60px}
  aside{position:static;max-height:none;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:10px}
  aside ul{columns:2}
  .milestones{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:640px){ aside ul{columns:1} .milestones{grid-template-columns:1fr} }
"""

# ---------- Markdown → HTML（覆盖本计划用到的子集） ----------

def anchor(text):
    t = re.sub(r'[`*_#\[\]\(\)]', '', text).strip()
    t = re.sub(r'\s+', '-', t)
    return t

def inline(s):
    s = html.escape(s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
    return s

def render_table(rows):
    head = rows[0]
    body = rows[1:]
    out = ['<div class="tbl-wrap"><table>', '<thead><tr>']
    for c in head: out.append('<th>%s</th>' % inline(c.strip()))
    out.append('</tr></thead><tbody>')
    for r in body:
        out.append('<tr>')
        for c in r: out.append('<td>%s</td>' % inline(c.strip()))
        out.append('</tr>')
    out.append('</tbody></table></div>')
    return '\n'.join(out)

def parse(md):
    lines = md.split('\n')
    out = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        # code fence
        if ln.lstrip().startswith('```'):
            lang = ln.strip()[3:]
            buf = []
            i += 1
            while i < n and not lines[i].lstrip().startswith('```'):
                buf.append(lines[i]); i += 1
            i += 1  # skip closing
            code = html.escape('\n'.join(buf))
            out.append('<pre><code>%s</code></pre>' % code)
            continue
        # heading
        m = re.match(r'^(#{1,4})\s+(.*)$', ln)
        if m:
            lvl = len(m.group(1)); txt = m.group(2)
            aid = anchor(txt)
            tag = 'h1' if lvl == 1 else 'h%d' % (lvl + 1)  # h1->h1(h1.doc), h2->h3? no
            # 保持层级：md # => h1, ## => h2, ### => h3, #### => h4
            tag = 'h%d' % lvl
            if lvl == 1: tag = 'h1'
            out.append('<%s id="%s">%s</%s>' % (tag, aid, inline(txt), tag))
            i += 1
            continue
        # table
        if ln.lstrip().startswith('|') and i + 1 < n and re.match(r'^\s*\|?[\s:|-]+\|?\s*$', lines[i+1]):
            rows = []
            while i < n and ln.lstrip().startswith('|'):
                cells = [c for c in ln.strip().strip('|').split('|')]
                rows.append(cells); i += 1
                if i < n: ln = lines[i]
            # drop separator row (rows[1])
            rows = [rows[0]] + rows[2:]
            out.append(render_table(rows))
            continue
        # hr
        if re.match(r'^\s*---+\s*$', ln):
            out.append('<hr>'); i += 1; continue
        # blockquote
        if ln.lstrip().startswith('>'):
            buf = []
            while i < n and lines[i].lstrip().startswith('>'):
                buf.append(re.sub(r'^\s*>\s?', '', lines[i])); i += 1
            cls = ' warn' if any('⚠' in b or '修正' in b for b in buf) else ''
            out.append('<blockquote%s>%s</blockquote>' % (cls, inline(' '.join(x.strip() for x in buf if x.strip()))))
            continue
        # list
        if re.match(r'^\s*[-*]\s+', ln):
            out.append('<ul>')
            while i < n:
                m = re.match(r'^( *)[-*]\s+(.*)$', lines[i])
                if not m: break
                indent, item = m.groups()
                if indent.count('  ') > 1:  # 深层，简单归并到外层
                    pass
                if re.match(r'^\[ \]', item):
                    rest = item[3:].strip()
                    out.append('<li class="todo"><span class="box"></span>%s</li>' % inline(rest))
                else:
                    out.append('<li>%s</li>' % inline(item))
                i += 1
                # 折叠子列表（缩进 > 当前）
                if i < n and re.match(r'^\s+[-*]\s+', lines[i]):
                    out.append('<ul>')
                    while i < n and re.match(r'^\s+[-*]\s+', lines[i]):
                        mm = re.match(r'^\s+[-*]\s+(.*)$', lines[i])
                        if mm:
                            it2 = mm.group(1)
                            out.append('<li>%s</li>' % inline(it2))
                        i += 1
                    out.append('</ul>')
            out.append('</ul>')
            continue
        # numbered list
        if re.match(r'^\s*\d+\.\s+', ln):
            out.append('<ol>')
            while i < n and re.match(r'^\s*\d+\.\s+', lines[i]):
                item = re.match(r'^\s*\d+\.\s+(.*)$', lines[i]).group(1)
                out.append('<li>%s</li>' % inline(item)); i += 1
            out.append('</ol>')
            continue
        # blank
        if not ln.strip():
            i += 1; continue
        # paragraph (merge until blank / special start)
        buf = [ln]; i += 1
        while i < n and lines[i].strip() and not re.match(r'^(#{1,4} |```|[-*>]|\s*\d+\.\s|\|)', lines[i]) and not re.match(r'^\s*---+\s*$', lines[i]):
            buf.append(lines[i]); i += 1
        out.append('<p>%s</p>' % inline(' '.join(x.strip() for x in buf)))
    return '\n'.join(out)

def build_toc(body, h2_titles):
    # 提取 h2 与 h4（h4 属于该 h2 的子项）；h3 只取数字开头的（0.x）
    tocs = []          # list of (id, text, children)
    cur = None
    for m in re.finditer(r'<h([234]) id="([^"]+)">(.*?)</h\1>', body):
        lvl = int(m.group(1)); aid = m.group(2); txt = re.sub(r'<[^>]+>', '', m.group(3))
        if lvl == 2:
            if cur: tocs.append(cur)
            cur = {'id': aid, 't': txt, 'c': []}
        elif lvl == 4 and cur is not None:
            cur['c'].append((aid, txt))
        elif lvl == 3 and re.match(r'^\d', txt) and cur is not None:
            cur['c'].append((aid, txt))
    if cur: tocs.append(cur)
    parts = []
    for item in tocs:
        parts.append('<a class="toc-h2" href="#%s">%s</a>' % (item['id'], item['t']))
        if item['c']:
            parts.append('<ul>')
            for aid, t in item['c']:
                parts.append('<li><a href="#%s">%s</a></li>' % (aid, t))
            parts.append('</ul>')
    return '\n'.join(parts)

def postprocess(html_text):
    """代码块/行内 code 内 ' 被 html.escape 转义为 &#x27;，在 <code> 内还原为 '。"""
    html_text = re.sub(r'<pre><code>(.*?)</code></pre>', lambda m: m.group(0).replace('&#x27;', "'"), html_text, flags=re.S)
    html_text = re.sub(r'<code>([^<]*)</code>', lambda m: m.group(0).replace('&#x27;', "'"), html_text)
    return html_text

def main(md_path, out_path, title, hero_html, tagline, brand_label, brand_sub):
    md = open(md_path, encoding='utf-8').read()
    body = postprocess(parse(md))
    toc = build_toc(body, None)
    doc = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%s</title>
<style>%s</style>
</head>
<body>
<div class="wrap">
  <aside>
    <div class="brand"><div class="dot">枢</div><div><b>%s</b><small>%s</small></div></div>
    <nav>%s</nav>
    <div class="tagline">%s</div>
  </aside>
  <main>
    <div class="hero">%s</div>
%s
  </main>
</div>
</body>
</html>""" % (html.escape(title), CSS, brand_label, brand_sub, toc, tagline, hero_html, body)
    open(out_path, 'w', encoding='utf-8').write(doc)
    print('written:', out_path)

if __name__ == '__main__':
    main(
        'docs/tianshu-优化实施计划.md',
        'docs/tianshu-优化实施计划.html',
        '天枢优化·详细实施计划',
        """<h1>天枢优化 · 详细实施计划</h1>
      <div class="sub">把《NomiFun vs 天枢》对比报告落成 <b>M0–M7</b> 八个可执行里程碑。每项含<b>目标 / 现状（代码实测）/ 任务 / 涉及文件 / 验收 / 风险</b>。动手前先对仓库做代码级核对，纠正了对比报告中 5 处与实测不符之处。</div>
      <div class="badges">
        <span class="badge"><b>8</b> 里程碑 · <b class="grn">3–5 周</b></span>
        <span class="badge"><b class="p0">先修地基</b> Migration + 排他锁</span>
        <span class="badge"><b class="p1">再补差异化</b> 进化解耦 + 进化工作台</span>
        <span class="badge gold">主线：M0→M1→M2</span>
      </div>
      <div class="meta">文档：dev/docs/tianshu-优化实施计划.md · 上游：nomifun-vs-tianshu-对比与优化方案.md · 由 markdown 自动转译</div>""",
        '上游对比报告<br>dev/docs/nomifun-vs-tianshu-对比与优化方案.md<br>生成：2026-09-03',
        '天枢优化', '实施里程碑 M0–M7'
    )
