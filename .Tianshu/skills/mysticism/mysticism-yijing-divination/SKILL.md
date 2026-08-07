# 易经起卦（mysticism-yijing-divination）

根据用户目标选择并激活对应子技能（按需加载，勿全部预加载）：

| 用户目标 | 激活子技能 |
|----------|-----------|
| 起卦解卦（`qi_gua.py` 本卦/变卦、变爻七规则取辞） | `mysticism-yijing-divination/gua` |
| 六爻京房纳甲（装卦：干支/世应/六亲/六神；用神旺衰） | `mysticism-yijing-divination/liuyao-yijing` |
| 梅花易数（时间/数字/文字起卦、本卦互卦变卦、体用五行） | `mysticism-yijing-divination/meihua-yishu-divination` |
| 道传小六壬速断（六宫吉凶、日常事项） | `mysticism-yijing-divination/xiaoliuren` |
| 周易决策辅助（铜钱/数字/时间起卦、哲学反思） | `mysticism-yijing-divination/yi` |
| 大衍之数/金钱卦/数字卦 + 象数理三层解读 + 八字排盘 | `mysticism-yijing-divination/cyber-iching-master` |

## 完整起卦工作流（串联）
1. 问卦前提醒（心诚则灵、一事不二占）→ 2. 主驱动起卦 → 3. 六爻/梅花交叉深断 → 4. 小六壬速断（按需）→ 5. 卦辞义理决策辅助 → 6. 跨流派融合结论（冲突时做对照说明）

## 边界
- 不占生死寿夭；不替人决断婚姻；不妄言国运；重疾/法律劝其求助专业
- 娱乐与自我反思，重大决策回归理性；脚本运行需 `PYTHONIOENCODING=utf-8`
- 详情见各子技能 SKILL.md