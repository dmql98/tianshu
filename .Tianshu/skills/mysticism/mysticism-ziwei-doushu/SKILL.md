# 紫微斗数（mysticism-ziwei-doushu）

根据用户目标选择并激活对应子技能（按需加载，勿全部预加载）：

| 用户目标 | 激活子技能 |
|----------|-----------|
| 标准化排盘（iztro JSON、真太阳时；禁 Python 直调 iztro） | `mysticism-ziwei-doushu/zwds-openclaw` |
| 经典通排（十二宫、十四主星、四化） | `mysticism-ziwei-doushu/ziwei-fortune` |
| 专业咨询报告（chart facts / 解读框架 / 实用趋势分离） | `mysticism-ziwei-doushu/ziwei-doushu` |
| 北派飞星（四化飞星、来因宫、真太阳时） | `mysticism-ziwei-doushu/ziwei-dou-shu` |
| 紫微八字融合校验（一套输入两体系交叉） | `mysticism-ziwei-doushu/destiny-fusion-pro` |
| 双人合盘（0-100 匹配分 + 维度分项 + hits） | `mysticism-ziwei-doushu/zwds-hepan-openclaw` |

## 完整命盘工作流（串联）
1. 采集出生信息（农历/公历、时辰、性别、出生地）→ 2. 标准排盘 → 3. 经典通排基线 → 4. 交付报告 → 5. 北派飞星专项 → 6. 紫微八字融合校验 → 7. 双人合盘（婚恋/合伙，按需）

## 边界
- 排盘只走 zwds-cli；禁 Python 直调 iztro、脱离 JSON 臆造星曜宫位；真太阳时须按出生地校正
- 合盘 score 为结构化契合指数（非命运/婚姻断言）；解读须对应 hits 证据
- 禁死亡预测、绝对化断言、推销改命；娱乐/自我探索，重大决策回归理性
- Node CLI 需在对应目录执行 `npm ci`；Python 脚本以 `PYTHONIOENCODING=utf-8` 运行

## 详情见各子技能 SKILL.md