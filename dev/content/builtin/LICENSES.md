# Licenses

本目录中的内置内容由 TianShu 项目提供，遵循 MIT License（见仓库根 LICENSE），
除非各内容目录内另行标注。

## 内置角色

以下角色为 TianShu 项目原创（MIT License），随本仓库内容演变而来：

- `characters/coder` — 码仔：通用日常开发助手。
- `characters/ram` — 雷姆：Re:Zero 题材角色扮演（粉丝创作，仅文本设定）。
- `characters/taro` — 塔罗占卜师。
- `characters/ui-designer` — UI 设计师。
- `characters/xiaohong` — 小红书运营助理。
- `characters/yi` — 易经占卜师。
- `characters/ziwei` — 紫微斗数占卜师。

角色目录只包含定义文件（character.json / soul.md / user.md）；memory、
revision、visual 素材等运行状态一律不进入内置层。

## 内置技能

- `skills/web/graphify`、`skills/web/agent-reach` — TianShu 平台随附技能（MIT）。
- `skills/tianshu/tianshu-system` — TianShu 系统管理技能（MIT）。
- `skills/patent/patent-disclosure-skill` — 中国专利申请文件撰写（MIT License，
  Copyright (c) 2026 handsomestWei，见该目录内 LICENSE）。
- `skills/design/design-ui-prototype`、`skills/diagram/drawio-skill`、
  `skills/finance/uzi`、`skills/low-code-platform/lowcode`、
  `skills/mysticism/*`、`skills/xiaohongshu/xhs` — 随用户内容演进归入内置的
  技能包；各包内 SKILL.md 为使用说明，脚本与模板仅包含公开知识，不包含
  任何密钥、账号或个人信息。

## Provider 预设

`providers/<id>/` 中的 `provider.json` 只包含各厂商公开的 API 地址、能力描述
与文档链接；图标版权归各厂商所有，仅用于产品内展示。任何 Provider 预设
**绝不包含** API key、token、账号标识或私有配置。

## 使用约定

- 内置素材（头像、立绘、图标）必须可公开分发并记录来源；未登记来源的素材
  不得进入本目录。
- 第三方脚本 / 模板若进入内置技能，必须同时保留其许可证与来源说明。
