---
name: tianshu-knowledge-management
description: "天枢独立文件知识库：登记/列出/删除知识库、列出库内文档、安装外部转换器并将 PDF/图片等转为可索引 Markdown，全部通过 knowledge_manage 工具完成。"
---

# 知识库管理

天枢的知识库能力由 `knowledge_manage` 工具提供：把磁盘上一个**目录**登记为「知识库」，库内的 `.md/.markdown/.txt` 文档会被递归索引；其他格式（PDF/图片等）可通过外部转换器（PaddleOCR/AnyDoc）先转成 Markdown 再入库。

> 工具名：`knowledge_manage`。若当前角色没有该工具，需先在角色的 `character.json` 中启用（工具绑定见 `tianshu-system/character`）。

## 数据结构

- 一个知识库 = 一个已登记目录，登记后获得 `kb_id`。
- 索引范围：`.md` / `.markdown` / `.txt`（递归扫描该目录）。
- 转换产物落在 `normalized/`：`convert` 把 `originals/` 下的原始文件转成 Markdown 后写入。
- 删除（`delete`）只撤销登记、删除索引关系，**不会删除磁盘上的目录文件**。

## 操作步骤

1. **列出已有知识库**：`knowledge_manage` action=`list`。先看是否已登记，避免重复登记同名目录。
2. **创建知识库**：action=`create`，必须给 `name`（知识库名）+ `path`（目录的**绝对路径**，可附 `description`）。返回 `kb_id`，后续操作都用它。
3. **查看库内文档**：action=`list_files` + `kb_id`，列出该库所有可索引文档（`.md/.markdown/.txt`，递归）。
4. **登记转换器**：action=`converters` 查看可用转换器；对未登记的转换器（如 `paddleocr`/`anydoc`）用 `install_converter` 登记并探测外部 CLI 是否可用。
5. **转换文档入库**：action=`convert` + `kb_id` + `converter` + `file`，把 `originals/` 下的原始文件（如 PDF、扫描图片）转成 Markdown，产物进 `normalized/`，随后即被当作可索引文档。
6. **删除知识库**：action=`delete` + `kb_id` 撤销登记（不删文件）。删除前先确认没有其他流程还在引用该库。

## 边界与注意

- `.txt` 本身可直接索引，**不需要**进转换池（AnyDoc 未声明 `.txt`）；`.png` 等图片格式仅能用 `paddleocr` 等 OCR 转换器。
- `create` 的 `path` 必须是**绝对路径**，且目录需真实存在，否则登记无效。
- 转换是外部 CLI 操作，可能较慢或依赖本机环境；`install_converter` 会探测 CLI，探测失败时先确认外部命令可用再转换。
- 本技能只覆盖「文件知识库」的登记/索引/转换；角色**私有记忆**（跨会话记忆快照 `memory_*`）是另一套机制，不要混为一谈。