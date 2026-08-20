# 天枢 · 角色与皮肤解耦改造方案（待确认）

> 状态：已按「角色元数据 skinId 绑定」设计落地（commit 9d44f87 + 后续修正）。

## 一、目标

- 把角色（character）主观定义与「视觉/动画」解耦：角色绑定皮肤，皮肤是一组可复用的视觉组合。
- 把现在写在 `characters/<id>/visual/` 的角色视觉与动画，抽离成独立「皮肤」实体。
- 角色管理页拆成两个分页：**角色** / **皮肤**。
- 皮肤文件放在 `dataDir/skin/` 下，按目录组织（`skin/miku`、`skin/ram`）。
- 每个皮肤包含：**立绘、头像、6 个动画**，文件名即语义（`立绘 / 头像 / working / idle / speak ...`），读取按文件名加载。

## 二、现状（调研结论）

### 数据层
- 角色视觉位于 `dataDir/characters/<id>/visual/`：
  - `visual.json`：动画清单（`defaultMotion` + `motions`，6 个 motion 各绑一个资产 id）
  - `assets.json`：资产索引（assetId → filename）
  - `assets/`：实际文件，**文件名是随机 UUID**（`casset_*.png/.mp4`）
- 核心后端：`web/server/src/character/visual-store.ts`、`web/server/src/data-paths.ts`
- 现有路径约定：`charactersRoot()/skillsRoot()/themesRoot()/iconPacksRoot()` → 加 `skinRoot()` 完全一致

### 前端
- 角色管理页：`web/client/src/pages/CharactersPage.tsx`（路由 `/characters`）
- 角色详情页：`web/client/src/pages/CharacterDetailPage.tsx`，内含视觉与动画 Tab → `CharacterVisualEditor.tsx`
- 渲染：`web/client/src/features/characters/CharacterRenderer.tsx`（按 motion 播放）
- 路由：`web/client/src/App.tsx`

### 数据模型
- `Character`（`web/client/src/types/index.ts`）目前无皮肤字段
- 后端 `characters` 路由：`/api/characters/:id/visual`、`/assets` 等

## 三、目标目录与文件约定

```
dataDir/
  skin/
    <skinId>/
      skin.json          # 轻量元数据：name、description、owner、文件清单
      立绘.png           # portrait（立绘）
      头像.png           # avatar（头像）
      working.mp4        # 动画 1
      idle.mp4           # 动画 2
      speak.mp4          # 动画 3
      ...（其余动画按 motion 命名）
```

> 说明：现有系统 motion 枚举为 `idle/blink/breathe/listening/thinking/speaking/toolCalling/working/success/error/happy/touched/wave/walk/jump/sleep`，而编辑器只暴露 6 个：`idle/thinking/working/speaking/success/error`。
> 你提到 `working/idle/speak` —— `speak` 与现有 `speaking` 是同义，需确认统一命名。

## 四、改造内容

### 1. 后端：新增 skin 模块
- `data-paths.ts` 新增 `skinRoot(): string`（=`resolve(dataRoot(), 'skin')`）
- 新增 `web/server/src/skin/skin-store.ts`：
  - `list()`：扫描 `skin/*` 目录，返回皮肤列表
  - `get(skinId)`：读 `skin.json` + 按文件名枚举立绘/头像/动画
  - `save/upload/delete`：上传文件落盘，文件名即语义
- `web/server/src/routes/skins.ts`：`/api/skins`、`/api/skins/:id`、`/api/skins/:id/upload` 等
- `Character` 增加 `skinId?: string` 绑定字段（写入 `character.json`）

### 2. 前端：皮肤管理分页 + 渲染适配
- `CharactersPage` 顶部加两个 Tab：**角色 / 皮肤**
  - 角色页：保持现状
  - 皮肤页：列出 `skin/*`，进入 `/skins/:id` 编辑（上传立绘、头像、6 动画）
- 新增 `SkinDetailPage`（`/skins/:id`）——上传/预览皮肤
- `CharacterDetailPage` 的「视觉与动画」Tab 改为：**选择/绑定一个皮肤**（替代原来直接上传到角色）
- `CharacterRenderer` 改为：按角色的 `skinId` 加载皮肤文件（按文件名）

### 3. 迁移与兼容
- 把现有 `characters/*/visual/assets` 按 `visual.json` 语义重命名迁移到 `skin/<名>/`
- 角色若无绑定皮肤 → 回退默认占位

## 五、已确认的设计决策

1. **动画命名统一**：皮肤 6 个动画沿用现有枚举 `idle/thinking/working/speaking/success/error`（`speaking` 即 `speak`）。
2. **分页形态**：`/characters` 页内「角色 / 皮肤」两个 Tab；皮肤编辑用独立路由 `/skins/:id`。
3. **绑定机制（最终设计）**：角色元数据 `character.json` 里维护 `skinId` 字段。
   - 角色详情页「激活」皮肤 → 把该皮肤 id 写入 `skinId`；
   - 「取消激活」→ 写 `null`；
   - `skinId` 为 `null`（或缺失）→ 展示与角色同名的默认皮肤 `skin/<角色id>/`；
   - 全系统展示（列表卡片/预览/会话舞台等）统一按生效 skinId 从 `skin/<skinId>/` 目录加载素材（前端 `CharacterRenderer` 走 `/api/characters/:id/visual` + `/assets/:assetId`，后端按生效皮肤虚拟解析，前端无需按皮肤改渲染）。
4. **皮肤归属**：皮肤可被多个角色复用（`boundCharacters` 仅记录归属供 UI 显示）。
5. **文件格式**：沿用现有 PNG/MP4，立绘/头像支持 png/jpg/jpeg/webp，动画支持 mp4/webp/gif。
