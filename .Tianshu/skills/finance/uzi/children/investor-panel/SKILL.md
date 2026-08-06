---
name: uzi-investor-panel
description: "65 位投资大佬评审团（UZI-Skill）。给定一只股票的 dimensions.json 和 raw_data.json，让 65 位投资者各自按方法论打分并输出 Signal（signal/confidence/score/verdict/comment）。覆盖经典价值、成长、宏观对冲、技术趋势、中国价投、A股游资、量化、科技领袖、AI卡位猎手 9 大流派。当用户请求\"评审团/65大佬怎么看/某某会买吗/大佬投票\"时使用。使用工作区内的 UZI-Skill 仓库。"
---

# Investor Panel · 65 贤评审团 (UZI-Skill)

## 调用上下文
- 输入：`.cache/{ticker}/dimensions.json` + `.cache/{ticker}/raw_data.json`
- 元数据：`scripts/lib/investor_db.py`(65 人) + `scripts/lib/seat_db.py`(22 位游资射程)
- 输出：`.cache/{ticker}/panel.json`

## 严格输出格式（每个投资者返回严格 JSON）
```json
{
  "investor_id": "buffett", "name": "巴菲特", "group": "A", "avatar": "avatars/buffett.svg",
  "signal": "bullish | neutral | bearish", "confidence": 87, "score": 82,
  "verdict": "强烈买入|买入|关注|观望|等待|回避|不达标|不适合",
  "reasoning": "1-3 句具体逻辑", "comment": "风格金句 1-2 句",
  "pass": [], "fail": [], "ideal_price": 16.20, "period": "3-5 年"
}
```
**Confidence 校准**：85-100 核心方法论硬指标全命中；60-84 多数命中；30-59 部分命中；0-29 不适用。
**游资射程预过滤**：22 位游资先 `is_in_range()`，不在射程 → `signal:neutral, verdict:"不适合"`。

## 7/9 大流派详细方法论
按需读取 `references/group-*.md`：A 经典价值(6) / B 成长(4) / C 宏观对冲(5) / D 技术趋势(4) / E 中国价投(6) / F 游资(22) / G 量化(3) / H 科技领袖 / I AI卡位猎手。

## 语料库 (必读)
生成 comment 前读 `references/quotes-knowledge-base.md` 查找真实公开原话和风格字段。每位怪评语必须像他本人（巴菲特温和引"Mr.Market"、芒格刻薄反常识、索罗斯提"反身性"、章盟主谈"格局"、赵老哥谈"题材/二板"）。

## 执行步骤
1. 加载元数据：`from lib.investor_db import INVESTORS, by_group` + `from lib.seat_db import SEATS, is_in_range`
2. 对每位投资者生成 Signal
3. 游资做射程预过滤
4. 汇总投票：`panel_consensus` / `vote_distribution` / `signal_distribution`

## 完成检查
- panel.json 包含 65 个 Signal，字段齐全
- 22 位游资里至少 N 位返回"不适合"（除非热门题材龙头）
- 三个汇总字段已计算

完整文档见 `<workspace>/UZI-Skill/skills/investor-panel/SKILL.md`。
