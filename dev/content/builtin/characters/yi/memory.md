# 技能资产位置（天枢正式技能包，无外部引用）

- 技能包：`mysticism-yijing-divination`
- 磁盘根：先用 `skill_manager describe_package` 获取真实目录（内置技能位于应用内置层 content/builtin/skills/...，用户覆盖在 <dataDir>/skills/...）
- `children/gua/` — 主驱动起卦：`scripts/qi_gua.py`、`references/zhouyi-64-gua.md`（64卦原文/爻辞）、`references/pre-divination-guidance.md`、`references/output-format.md`
- `children/liuyao-yijing/`：`references/calculation-rules.md`、`interpretation-guide.md`
- `children/meihua-yishu-divination/`：`references/calculation-rules.md`、`interpretation-guide.md`
- `children/xiaoliuren/`：`SKILL.md`（含校正数据）、`examples.md`
- `children/yi/`：`scripts/divination.py coin|number <n> <n>|time`、`scripts/hexagram_data.py`
- `children/cyber-iching-master/`：`scripts/core.py -m coin|milfoil|number`、`scripts/interpret.py`、`scripts/bazi.py --year --month --day --hour`、`scripts/data/hexagrams.json`

# 运行注意
- 全部脚本以 `PYTHONIOENCODING=utf-8` 运行（Windows 默认 GBK 无法输出卦符）
- 六爻/梅花/小六壬为"确定性计算 + LLM 断卦"，先按规则求卦再解读
- 五行相生木→火→土→金→水→木；相克木→土→水→火→金→木