# TianShu Builtin Content

本目录是 TianShu 随应用发布的只读发行内容层（`content/builtin`）。

- 运行时**只读**：服务端不提供任何修改 builtin 的 API。
- 用户编辑内置角色 / 技能时，先自动物化（copy-on-write）完整用户副本到
  `<dataDir>/characters/<id>` / `<dataDir>/skills/<category>/<id>`，再写用户层。
- 同 ID 用户内容完整覆盖内置内容，不做逐字段隐式合并。
- 升级安装包只更新本目录，不覆盖用户个人副本与状态。
- 本目录**禁止**包含 memory、revision、会话、密钥、用户上传、缓存、日志或运行产物。

## 目录结构

```text
content/builtin/
├── manifest.json      # 内容协议与发行版本（白名单校验入口）
├── README.md
├── LICENSES.md
├── characters/        # 内置角色定义（character.json + soul.md 等）
├── skills/            # 内置技能 package（skill-package.json + SKILL.md）
├── iconpacks/         # 内置图标包（pack.json + assets/*.svg，只读）
└── providers/         # Provider 公开预设（provider.json + icon.svg）
```

图标包（iconpacks/）与用户图标库同构：每个包一个目录 `lucide/`、
`streamline-freehand/`，内含 `pack.json` + `assets/` SVG。差异仅在来源：
内置包只读（服务端从本层读取），用户包可写（`<dataDir>/iconpacks`）。
新增/替换内置图标 = 将 SVG 放入对应包的 `assets/` 并更新 `pack.json`，
再运行 `node scripts/generate-builtin-iconpacks.mjs` 重建清单。

## 使用

- 开发模式：server 自动定位仓库根 `content/builtin`。
- 打包模式：Electron 主进程设置
  `TIANSHU_BUILTIN_CONTENT_DIR=<process.resourcesPath>/content/builtin`。
- 测试 / 容器 / 高级用户可用 `TIANSHU_BUILTIN_CONTENT_DIR` 显式覆盖。
