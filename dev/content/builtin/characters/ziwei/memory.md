# 技能资产位置（天枢正式技能包，无外部引用）

- 技能包：`mysticism-ziwei-doushu`（磁盘根先用 `skill_manager describe_package` 获取真实目录；内置技能在应用内置层 content/builtin/skills/...，用户覆盖在 <dataDir>/skills/...）
- `children/zwds-openclaw/` — 标准排盘：`zwds-cli/` 下 `npm ci`；stdin 一行 JSON，`echo '{"birth_time":..,"gender":..,"birth_place":..}'|node src/index.js`；stdout 一行 JSON 取 `data`；含 `data/longitudes.json`、`fixtures/`；真太阳时校正
- `children/ziwei-fortune/` — `references/calculation-rules.md`（命身/十二宫/五行局/星系/四化/辅煞）、`references/interpretation-guide.md`
- `children/ziwei-doushu/` — `python scripts/ziwei_chart.py --date --time --gender --year --engine py|js|dual --template lite|pro|executive --format markdown|json`（北京标准 Asia/Shanghai、经度120）
- `children/ziwei-dou-shu/` — `node scripts/calculate.js --birth --location --gender`；`references/beipai-sihua.md`（四化）/`stars.md`/`palaces.md`/`yunxian.md`
- `children/destiny-fusion-pro/` — `python scripts/fortune_fusion.py --date --time --gender --year --from-year --years --template --format`
- `children/zwds-hepan-openclaw/` — `hepan-cli/` 下 `node src/index.js`，stdin 含 `chart_a`/`chart_b`（各人 data）/`reference_year`；输出 `score 0-100`+四维+`hits`+`penalty`

# 运行注意
- Node CLI 需 `npm ci` 装 iztro 依赖；Python 以 `PYTHONIOENCODING=utf-8` 运行
- 三方四正：对宫(i+6)%12、财帛(i+4)%12、官禄(i+8)%12
- 合盘 score 为结构化契合指数，非命运/婚姻断言；解读基于 `hits[].evidence`
- 北派解象次序：先生年四化→向心自化→离心自化→飞宫碰撞