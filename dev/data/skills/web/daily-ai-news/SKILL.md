---
name: daily-ai-news
description: 搜集当日 AI 科技新闻，从 Hacker News / TechCrunch / The Verge 等多源聚合，输出中文摘要
tags: ["news", "ai", "web", "research"]
version: 1.0.0
metadata:
  yilin:
    tags: [news, ai, aggregation, web]
    related_skills: [deep-dive-article, news-summary]
    prerequisites: []
    conflicts_with: []
---

# Daily AI News 每日 AI 新闻聚合

## 目标
当用户问"今天有啥 AI 新闻"或类似问题时，从多个英文和中文来源搜集当日 AI/科技新闻，汇总为简洁的中文摘要呈现给用户。

## 核心流程

### 第一步：并行搜集多源信息

同时发起以下搜索和抓取请求（一次 tool call batch 完成）：

1. **websearch** — 英文搜索（关键词含日期）
2. **websearch** — 中文搜索（关键词含日期）
3. **webfetch** — 直接抓取 HN 首页
4. **webfetch** — 直接抓取 The Verge AI 频道

```javascript
// 伪代码 — 并行执行
search_en = websearch("AI news today")
search_cn = websearch("人工智能 新闻 today")
hn_page = webfetch("https://news.ycombinator.com/")
verge_page = webfetch("https://www.theverge.com/ai-artificial-intelligence")
```

### 第二步：智能提取新闻条目

从抓取结果中提取新闻条目，**不要返回导航栏、页脚、侧边栏**：

- **Hacker News**: 匹配标题行链接（`titleline` 或 `athing` 后的链接文本）
- **The Verge**: 匹配文章标题（`<h2>` / `<h3>` / 卡片标题）
- **websearch 结果**: 提取每条结果的 title + snippet + link

### 第三步：去重与排序

- 跨源去重（同一新闻出现在多个源则合并，标记来源）
- 按热度/相关性排序
- 保留关键细节（公司名、产品名、融资金额等）

### 第四步：输出中文摘要

格式如下（Markdown）：

```
## 🤖 今日 AI 新闻速递 (YYYY-MM-DD)

### 头条
**{标题}** — {一句话摘要} [来源](链接)

### 行业动态
1. **{标题}** — {摘要} [源1](link1) [源2](link2)
2. ...

### 产品发布
...

### 政策 & 安全
...
```

### 第五步：容量控制

- 头条不超过 3 条
- 其余分类每条不超过 5 条
- 总计不超过 20 条

## 回退策略

如果 websearch 返回空结果（如该 session 无搜索能力）：

| 问题 | 方案 |
|---|---|
| websearch 全部为空 | 只用 webfetch 抓取已知源：HN + The Verge + TechCrunch |
| webfetch 被屏蔽 | 尝试 `fetch` 或 browser 工具打开页面再 snapshot |
| 所有远程源不可用 | 告诉用户"暂时无法获取，可稍后再试"，不要编造新闻 |

## 约束

- **不要编造新闻** — 每一条都必须有来源链接
- **不要全文翻译** — 只摘要核心信息
- **时效性优先** — 优先当天的新闻，若当天无新闻可覆盖近 3 天
- **中文输出** — 所有摘要用中文，保留英文专有名词（如 GPT-5、Copilot）
- **不爬付费墙** — 只抓取公开页面内容

## 完成条件

- [ ] 输出了结构化的中文新闻摘要
- [ ] 每条新闻都有可点击的原文链接
- [ ] 至少包含 3 条以上当日新闻（除非确实没有）
- [ ] 没有导航栏/HTML 标签等原始页面噪音
