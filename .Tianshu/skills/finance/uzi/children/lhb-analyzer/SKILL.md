---
name: uzi-lhb-analyzer
description: "龙虎榜深度分析器（UZI-Skill）。识别游资席位、判断机构 vs 游资博弈、对照同板块龙虎榜找辨识度龙头。当用户问\"谁在买这只票/最近龙虎榜怎么样/X游资有没有上榜/这是不是X的票\"时使用。使用工作区内的 UZI-Skill 仓库。"
---

# 龙虎榜深度分析 (UZI-Skill)

## 调用上下文
输入：股票代码或个股名
输出：龙虎榜分析 + 游资识别 + 同板块对比

## 数据流
```bash
cd <workspace>/UZI-Skill/skills/deep-analysis/scripts
python fetch_lhb.py <ticker>
```
1. 调用 `fetch_lhb.py {ticker}` 拿到原始龙虎榜数据
2. 调用 `lib/seat_db.py::match_seats_in_lhb()` 识别游资席位
3. 用 `lib/seat_db.py::is_in_range()` 判断该游资是否在射程内
4. 拉取同板块龙虎榜对比

## 输出 markdown 结构
```markdown
# {name} ({ticker}) 龙虎榜分析
## 📅 近 30 天上榜 X 次
## 🐉 识别到的游资 (Y 位)
| 游资 | 风格 | 在不在射程 | 买入/卖出 |
## ⚖️ 机构 vs 游资   (净买入/主导方)
## 🏆 同板块辨识度龙头   (排名/上榜次数/累计涨幅)
## 💡 结论一句话
```

## 参考资料
22 位游资席位百科见 `<workspace>/UZI-Skill/skills/lhb-analyzer/references/seat-encyclopedia.md`。
完整文档见 `<workspace>/UZI-Skill/skills/lhb-analyzer/SKILL.md`。
