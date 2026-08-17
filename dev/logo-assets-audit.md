# 天枢客户端 Logo/图标素材审计

> 审计日期：2026-08-17
> 范围：`web/client`（React 渲染层）、`desktop`（Electron 壳）、`content/builtin`（内置角色/技能/Provider 数据）

## 一、已有真实素材（无需处理）
- 应用 Logo：`web/client/public/logo.png`（导航栏 nav-logo、DesktopTitleBar、favicon）
- 桌面图标：`desktop/assets/icon.ico` + `icon.png`（Windows）；macOS 缺 `icon.icns`
- Provider 图标：`content/builtin/providers/*/icon.svg`（17 家，经 /api/providers/builtin/<id>/icon 下发）✅ 全客户端唯一「数据带图标」范式
- 角色立绘：`content/builtin/characters/*/visual/*.png`（coder 缺，回退首字）

## 二、emoji 占位清单（跨平台风险源）
### 1. 侧边导航栏（最高频）App.tsx
会话 💬 / 角色 🎭 / 技能 ⚡ / 工具 🔧 / MCP 🔗 / 知识 📚 / 市场 🏪 / 事件 ⚡ / 设置 ⚙️

### 2. 市场页「星河」MarketPage.tsx（40+ 处静态 mock）
- 角色卡：长庚 🌟 天璇 ⚙️ 文曲 📝 紫微 👑 文档管家 📚
- 技能卡：Deep Research 🔬 Code Review Pro 🔍 自动化测试 🧪 UI Design 🎨
- MCP 卡：Context7 📖 Playwright 🎭 CodeGraph 🔍 Brave Search 🌐
- 工具卡：📊 🌐 📁；区块标题 🌟🔥📊🎭⚡🔗🔧💡

### 3. 聊天页
- ToolCall.tsx：📄 ✏️ 🔧 ⚙️ 🔍 📂
- ChatArea.tsx：☰ 👤 📁；SessionPanel.tsx：📁 ⭐ ☆ ✏️ 📋 📤 🗑️ 📂 ✓ ☰
- FilePanel.tsx：🖼️ 📎 📖 ✏️ 📂；ChatInput.tsx：🖼️ 📎
- 对话框：❓ ⚠️ ⛔ ✓ ✗ 🎯 ✕ ⚠；ChatPage 空态 💬

### 4. 设置页 Tab：🔗 ⚙️ 🎨 💬 ⚡ ℹ️
### 5. 事件页：⏳ ▶ ✓ ✗ 📦，agent 回退 👤
### 6. 技能页：统一 📦（无区分度）、📄、⚡
### 7. 知识库页：📁 📂 👁️ 🏠
### 8. 主题工作台预览字形（风险低）：● ◆ ⚡ ✦ ▣ ⚙ ☰ ＋ ↑
### 9. 杂项：✕ ✎ ✏ 🗑 ➕

## 三、数据模型层缺口
- 角色 character.json：只有 color，无 icon 必填（xiaohong avatar 为空串）
- 技能包 SkillPackageMeta：无 icon 字段 → 所有包统一 📦
- 市场数据：前端硬编码 emoji，无 icon_url 字段
- 工具调用：前端写死 emoji 映射

## 四、改造建议（按优先级）
1. P0 导航栏 + 聊天工具图标：建内联 SVG Icon 组件全局替换
2. P0 数据模型加 icon 字段：角色/技能包/市场条目沿用 provider icon.svg 范式
3. P1 市场页随真实服务接入 icon_url，回退品牌默认图
4. P1 macOS 生成 icon.icns
5. P2 清理未引用 logo.jpg / yi-logo.png；coder 补立绘
