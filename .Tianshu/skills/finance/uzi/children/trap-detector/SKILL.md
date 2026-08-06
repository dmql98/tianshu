---
name: uzi-trap-detector
description: "杀猪盘检测器（UZI-Skill）。当用户提到\"朋友推荐\"、\"群里说\"、\"老师带\"、\"内幕消息\"、\"小红书/抖音看到推荐\"，或显式要求\"看看是不是杀猪盘 / 检测风险 / 这只票安全吗\"时使用。扫描 8 个信号给出风险评级 🟢🟡🟠🔴。使用工作区内的 UZI-Skill 仓库。"
---

# Trap Detector · 杀猪盘检测器

## 触发场景
- 用户输入含关键词：朋友推荐、群里、老师带、内幕、必涨、翻倍、暴涨、稳赚、跟单
- 显式要求：检测一下、是不是杀猪盘、安不安全、被套路了吗

## 8 信号扫描清单
1. 大量低质量账号同时推荐 — web search 该股名 + "推荐"
2. 推荐话术模板化 — 搜 "{name} 即将爆发"、"主力建仓完毕"、"目标翻倍"
3. 付费社群 / VIP 直播间引流 — 搜 "{name} 微信群"、"{name} 直播间"、"{name} VIP"
4. 基本面与热度脱节 — 调用 fetch_financials + fetch_sentiment 对比
5. K 线异常配合 — 调用 fetch_kline，看是否在推荐密集期前已大幅拉升
6. 老师 / 股神人设推广 — 搜 "{name} 老师"、"{name} 股神"
7. 跨平台联动推广 — 搜小红书 / 抖音 / B 站 / 知乎
8. 虚假研报 / 伪造消息 — 搜 "{name} 谣言"、"{name} 辟谣"

## 风险评级
| 命中信号数 | 评级 | 建议 |
|---|---|---|
| 0-1 | 🟢 安全 | 数据正常 |
| 2-3 | 🟡 注意 | 建议核实信息源 |
| 4-5 | 🟠 警惕 | 强烈建议谨慎 |
| 6+ | 🔴 高度可疑 | 强烈建议回避 |

用户提到"朋友推荐/群里/老师带"→+1，"内幕消息/稳赚不赔"→+2，"必涨/翻倍/暴涨"→+1。

## 输出 JSON
```json
{
  "ticker": "...", "trap_score": 1-10, "trap_level": "🟢 安全",
  "signals_hit": [{"id":3,"name":"付费社群引流","evidence":"...","severity":"high","sources":["url"]}],
  "user_keyword_boost": 1,
  "recommendation": "🟢 未发现明显推广痕迹，可正常分析。",
  "warning_phrases": []
}
```

## 执行
```bash
cd <workspace>/UZI-Skill/skills/deep-analysis/scripts
python fetch_kline.py <ticker>
python fetch_financials.py <ticker>
python fetch_sentiment.py <ticker>
```
结合 web search 扫描上述 8 信号。

## 完成检查
- 8 个信号每个都给出"命中/未命中/数据不足"
- 至少有 1 条具体证据 URL（除非全部安全）
- recommendation 必须有
- 若 ≥4 信号，必须用 "强烈建议谨慎" 或 "强烈建议回避" 开头

完整文档见 `<workspace>/UZI-Skill/skills/trap-detector/SKILL.md` 与 `references/eight-signals.md`。
