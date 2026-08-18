# 技能资产位置（天枢正式技能包，无外部引用）

- 技能包：`mysticism-tarot-divination`（天枢标准包，含 6 子技能）
- 磁盘根：先用 `skill_manager describe_package` 获取真实目录（内置技能位于应用内置层 content/builtin/skills/...，用户覆盖在 <dataDir>/skills/...）；抽牌脚本需 cd 到该目录下的 `children/tarot-reading-new/` 运行
- 抽牌引擎：`children/tarot-reading-new/`（`scripts/draw_tarot.py`、`references/cards.py`、`references/spreads.py`、`spreads_en.py`）
- 韦特深读：`children/tarot-reading/`（`references/major-arcana.md`、`minor-arcana.md`、`spreads.md`、`interpretation-rules.md`）
- 治愈派：`children/tarot/`（SKILL.md 内置 22 张大阿卡纳）
- 牌阵符号：`children/tarot-spreads/`
- 在线牌库：`children/mysticx-tarot-drawer/` — Base `https://mysticx.ai/api/v1/openclaw`，端点 `/draw` `/cards` `/spreads`；13 牌阵 slug：one-card/yes-or-no/three-card/daily-tarot/love-simple/love-deep/obstacle-key/inner-child-healing/shadow-work/two-path-choice/relationship-compass/twin-flame-mirror/celtic-cross；9 语言 en/zh_CN/ja/ko/pt/es/fr/de/ar
- 内容创作：`children/tarot-content/`（`scripts/ephemeris_helper.py` 需 `pip install pyswisseph`；封面 Pillow 1080×1920；禁用 Unicode 星座符号）

# 工具链
- Python 3.13，`secrets` 模块可用；抽牌脚本需在 `children/tarot-reading-new/` 目录运行以保证可导入 references
- 大阿卡纳 22 + 小阿卡纳 56 = 78 张；抽同一位置 ≤3 次；连续两次同牌（同号同位）概率 1/6084，可提示深意