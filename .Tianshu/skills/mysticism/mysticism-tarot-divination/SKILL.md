# 塔罗占卜（mysticism-tarot-divination）

根据用户目标选择并激活对应子技能（按需加载，勿全部预加载）：

| 用户目标 | 激活子技能 |
|----------|-----------|
| 加密随机抽牌（真随机）、是否/建议/提醒/找物、9 种牌阵 | `mysticism-tarot-divination/tarot-reading-new` |
| 韦特体系 78 张正逆位深读、综合法、特殊卡 | `mysticism-tarot-divination/tarot-reading` |
| 治愈反思派、情感支持、临在非预测 | `mysticism-tarot-divination/tarot` |
| 单牌 / 三牌 / 凯尔特十字象征叙事 | `mysticism-tarot-divination/tarot-spreads` |
| 13 种在线牌阵 / 浏览 78 张牌库（MysticX API） | `mysticism-tarot-divination/mysticx-tarot-drawer` |
| 塔罗×占星内容：周运脚本 / 视频 / 封面 / 内容日历 | `mysticism-tarot-divination/tarot-content` |

## 完整占卜工作流（串联）
1. 理解问题类型 → 2. 定阵型 → 3. 随机抽取（真随机、不重复、正逆 50/50）→ 4. 逐张解读 → 5. 综合叙事 → 6. 心理向重述（治愈派，避免宿命论）→ 7. 换阵/二次看或内容输出（按需）

## 边界
- 娱乐与自我反思，非医疗/法律/金融建议；不预测生死；用户危机时优先安全支持
- 详情见各子技能 SKILL.md