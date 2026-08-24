# Yuxi 0.7.1 知识库设计借鉴分析

> 分析对象：`C:\Users\dmql\Downloads\Yuxi-0.7.1\Yuxi-0.7.1`（语析 Yuxi，多租户 Harness + 企业知识库，RAG + Milvus 图谱 + LangGraph 多智能体）
> 对照对象：天枢「知识体系构建」`00-03`（角色记忆 + 独立文件知识库 + 权限治理）
> 目的：提炼可借鉴/可复用的架构、分块/解析、检索融合、前端交互与评测思路，并标注差异与风险。
> 结论先行：**天枢已有的「记忆/知识/代码图 三域严格分离」方向比 Yuxi 更清晰，不应照搬其耦合方式**；但 Yuxi 在「检索配置驱动 UI、分块预设、可插拔解析、状态机并发控制、图谱 PPR 增强检索、评测套件、对话内引用展示」上已有成熟实现，可直接借鉴其思路与交互。

---

## 1. 执行摘要

| 维度 | Yuxi 现状（可借鉴性） | 对天枢二期的建议 |
|---|---|---|
| 知识库抽象 | `KnowledgeBaseFactory` + `KnowledgeBase(ABC)` + 多实现（Milvus/Dify/Notion），Manager 按 `kb_type` 分发 | **借鉴**：用工厂+抽象基类做可插拔向量库，便于后续替换/新增实现 |
| 检索配置 | `MilvusRetrievalConfig`（dataclass 字段带 UI 元数据）+ 后端 `_retrieval_config_options()` 暴露 + 前端 `SearchConfigPanel` **动态渲染** | **强烈借鉴**：检索参数由后端声明、前端自动生成表单，是「检索调试器」最低成本实现 |
| 检索融合 | vector / keyword(BM25 in Milvus) / hybrid(`WeightedRanker`) + reranker + 图谱 RRF 融合 | **对齐**：与天枢 02 的 BM25+向量+RRF 一致；可参考其 `WeightedRanker`/RRF 实现 |
| 解析 | `DocumentProcessorFactory` + 7 种处理器注册表 + `Parser.aparse` 统一入口 + docling 转 Office | **借鉴**：可插拔解析层正好补天枢二期 docx/xlsx/pptx/pdf 支持 |
| 分块 | 6 类预设（general/qa/book/laws/semantic/separator）+ 三级参数合并（KB/文件/请求） | **借鉴**：天枢现设计仅「Markdown 标题层级」一种，应引入预设机制 |
| 状态机 | `uploaded→parsed→indexing→indexed/error`，`update_fields_if_status` 乐观锁 claim | **借鉴**：并发安全，避免重复解析/索引 |
| 图谱 | Milvus 向量 + Neo4j 存储，**实体/三元组抽取 + PPR 增强检索**，与向量结果 RRF 融合 | **注意边界**：这是「文档知识图谱」，与天枢 CodeGraph/Graphify（代码图）**不是一回事**；可作为 KB 内**可选**能力，但绝不并入代码图 |
| 评测 | `Recall@K`/`F1@K`、LLM Judge、benchmark 生成、RAG 评测 Tab | **借鉴**：天枢 03 只提指标未实现，Yuxi 有可直接参考的度量与 UI |
| 前端对话内引用 | `QueryKbTool` 卡片展示 chunks + 图谱实体/关系 + 引用链接 | **借鉴**：天枢引用展示可直接复用该交互 |
| 前端检索调试 | `QuerySection` 原始/格式化切换、分数、来源/文件ID/块索引、示例问题生成 | **借鉴**：对应天枢 02 的「检索调试器」要求 |

> **轻量路线提示**：上表「知识库抽象 / 检索融合」中 Yuxi 的 Milvus/向量默认路径，对天枢应降级为**可选增强**——详见第 9 节「轻量替代架构」：FTS5(BM25) 常驻主力 + 本地向量可关 + LLM wiki/导图导航层，不引入 Milvus/Neo4j。

---

## 2. Yuxi 知识库架构速览

### 2.1 后端分层（来自 `ARCHITECTURE.md` + 代码）

```
server/routers        → HTTP 薄层，/api 挂载（LITE 模式下不注册 kb/graph/eval 路由）
yuxi/knowledge/        → 知识库领域
  ├─ manager.py        → KnowledgeBaseManager：多类型分发、权限、一致性检测
  ├─ factory.py        → KnowledgeBaseFactory：按 kb_type 创建实例
  ├─ base.py           → KnowledgeBase(ABC)：文件状态机、markdown/MinIO、检索裁剪
  ├─ schemas.py        → SearchInput/Find/Open 的 Pydantic Schema
  ├─ runtime.py        → 单例装配：注册实现 + 实例化 Manager
  ├─ implementations/  → milvus.py / dify.py / notion.py / read_only_connectors.py
  ├─ chunking/ragflow_like/ → presets(dispatcher/parsers: general/qa/book/laws/semantic/separator)
  ├─ parser/           → factory/registry/unified + 7 种处理器
  ├─ graphs/           → milvus_graph_service(PPR) + milvus_graph_vector_store + extractors
  └─ eval/             → metrics / evaluator / service / benchmark_generation
```

关键事实（已在代码中核实）：
- `KnowledgeBaseManager` 直接走 `Repository`（Postgres），**不维护冗余缓存**，只缓存「已加载的 KB 实例」。
- `runtime.py` 在 `LITE_MODE` 下**不注册 MilvusKB**，仅注册 Dify/Notion——这是避免重依赖的清晰边界，天枢可借鉴「轻量模式跳过重依赖」。
- 权限用 `share_config = {access_level: global|department|user, department_ids, user_uids}`，`_database_info_accessible()` 在 Manager 层做最终过滤。

### 2.2 检索核心（`milvus.py` 中 `aquery`）

```
search_mode:
  vector  → embedding 相似度
  keyword → Milvus BM25 稀疏检索
  hybrid  → AnnSearchRequest ×2 + WeightedRanker(vector_weight, bm25_weight)
if use_reranker: 候选召回 recall_top_k → reranker 精排 → final_top_k
if use_graph_retrieval: 图谱 PPR 召回 → _fuse_chunk_rankings() 用 RRF(k=60) 融合
返回 retrieved_chunks[:final_top_k]，含 score / rerank_score / graph_score / source / chunk_id / file_id / chunk_index
```

`MilvusRetrievalConfig`（`milvus.py:83-262`）把每个检索参数定义为 dataclass 字段，并带 `metadata={label,type,options,min,max,step,description,depend_on}`；`_retrieval_config_options()`（`milvus.py:264`）把这些字段序列化成「前端可直接渲染的表单描述」。这是**配置驱动 UI** 的核心，详见第 4 节。

### 2.3 前端结构（`web/src`）

```
views/DataBaseView.vue        → 知识库列表/创建/共享权限(access_level)
views/DataBaseInfoView.vue    → 详情：文件树、待解析/待索引计数、chunk 预设编辑、删除
components/SearchConfigModal.vue → 检索配置弹窗，内嵌 SearchConfigPanel
components/SearchConfigPanel.vue → 依据后端 options 动态渲染检索参数表单（含 depend_on 联动）
components/QuerySection.vue     → 检索调试：原始/格式化切换、分数、来源/文件ID/块索引、示例问题
components/ChunkParamsConfig.vue→ 6 类分块策略 + token/重叠/分隔符
components/sources/KbChunkDetailModal.vue → chunk 详情（相似度 + 行号）
components/ToolCallingResult/tools/QueryKbTool.vue → 对话内知识库结果卡片（chunks+图谱+引用）
components/MindMapSection.vue / KnowledgeGraphSection.vue → 图谱/思维导图可视化
apis/knowledge_api.js          → database/document/graphBuild/mindmap/query/evaluation/file/type 分层
```

---

## 3. 后端可借鉴点（含代码定位）

### 3.1 可插拔知识库抽象（高价值，天枢应吸收其「接口契约」）
- `factory.py`：`register(cls)`/`create(kb_type,...)`/`get_available_types()`，通过类属性 `kb_type/kb_class.name/requires_embedding_model/supports_documents/get_create_params_config()` 自描述。
- `base.py`：`KnowledgeBase(ABC)` 定义统一生命周期（`create_database/add_file_record/parse_file/index_file/aquery/delete_file/get_database_info...`）。
- 借鉴点：天枢二期若考虑「可替换向量库（本地 SQLite-FTS / 外接 Milvus 等）」，可沿用此工厂+ABC 模式，避免把向量库选型写死。

### 3.2 检索配置驱动 UI（最高价值，对应天枢 02「检索调试器」）
- 后端：`MilvusRetrievalConfig`（`milvus.py:83`）每个字段带 UI 元数据；`_retrieval_config_options()` 生成 `{key,label,type,options,min,max,step,description,depend_on}` 列表。
- 前端：`SearchConfigPanel.vue` 用 `a-form` 按 `param.type`（select/boolean/number/input）+ `depend_on` 联动**全自动渲染**，并支持 localStorage 草稿、重置默认。
- 借鉴点：**天枢不必为每种检索参数手写表单**。定义一份「检索参数 Schema（含类型/范围/依赖/描述）」→ 后端 `/query_params` 暴露 → 前端通用渲染器。这同时服务「配置页」和「调试器」，与天枢 02 §11 完全吻合。

### 3.3 检索融合与降级（对齐天枢 02 §8）
- `aquery`（`milvus.py:894`）：vector/keyword/hybrid 三模式 + `WeightedRanker` 权重融合 + 可选 reranker。
- 图谱召回与向量召回用 **RRF（k=60）** 融合（`_fuse_chunk_rankings`，`milvus.py:1193`）。
- 借鉴点：与天枢「BM25 + 向量 + RRF、Provider 故障走 lexical-only」一致。Yuxi 的实现确认该路线可行；天枢可参考其 `WeightedRanker`/RRF 代码，并注意其 `similarity_threshold` 在向量与混合模式下都生效的过滤方式。**注意**：天枢应把向量检索视为**可关增强**（第 9 节）——默认纯 FTS5，仅在启用本地向量时走混合/RRF，避免默认引入独立向量服务。

### 3.4 解析层可插拔（补天枢二期格式支持）
- `parser/registry.py`：`PROCESSOR_TYPES` 注册 7 种处理器（rapid_ocr/mineru/mineru_official/pp_structure_v3/deepseek_ocr/paddleocr_vl_1_6/paddleocr_pp_ocrv6）。
- `parser/factory.py`：`DocumentProcessorFactory` 单例缓存 + `BaseDocumentProcessor(ABC)`（`process_file/check_health/supports_file_type`）。
- `parser/unified.py`：`Parser.aparse(source, params)` 统一入口 + docling 转 docx/csv，按扩展名路由；图片落 MinIO。
- 借鉴点：天枢二期 §3 要支持 docx/xlsx/pptx/pdf/html/csv，应建立同类「解析器注册表 + 统一入口 + 健康检查」，而非在单点写 if-else。扫描 PDF/OCR 走 `unsupported_ocr` 明确报错（对齐天枢 §3「不能产生空白知识源」）。

### 3.5 分块预设机制（补天枢单一种类）
- `chunking/ragflow_like/presets.py`：6 类预设（general/qa/book/laws/semantic/separator），各自有 label/description。
- `resolve_chunk_processing_params()`（`presets.py:91`）：**三级合并**（KB 默认 → 文件级 → 请求级，`deep_merge`），最终产出 `{chunk_preset_id, chunk_parser_config, chunk_engine_version}`。
- `dispatcher.py`：按 preset 分派到对应 parser，`_build_chunk_records` 记录 `start_char_pos/end_char_pos/chunk_id`。
- 借鉴点：天枢 02 §7 仅「Markdown 标题层级」，可扩展为预设体系；并保留 `chunk_engine_version` 以支持分块引擎升级时「Chunk ID 稳定」的约束（对齐天枢 §7「Chunk ID 从首版稳定」）。

### 3.6 文件状态机 + 乐观锁（并发安全）
- `base.py` `FileStatus`：`uploaded→parsed→indexing→indexed/error_indexing`。
- `index_file`（`milvus.py:647`）：调用 `update_fields_if_status(allowed_statuses, data)` **先 claim `INDEXING` 再处理**，失败回写 `ERROR_INDEXING`。`update_content` 同理。
- 借鉴点：天枢二期异步转换/索引应复用「状态前置校验 + 乐观 claim」，避免 worker 重复处理同一文件。

### 3.7 一致性检测（运维保障）
- `manager.detect_data_inconsistencies()`（`manager.py:883`）：比对 Milvus 集合与 Postgres 元数据，找出孤儿集合/文件。
- 借鉴点：天枢二期应提供「向量库 vs 元数据」一致性巡检与修复（对齐天枢 03 §6 删除物理清理 + 报告）。

---

## 4. 前端可借鉴点（重点：天枢知识库前端目前是占位）

### 4.1 检索调试器（天枢 02 §11 直接对应）
`QuerySection.vue` + `SearchConfigPanel.vue` 已完整实现天枢要的「BM25、向量、RRF、过滤、最终引用」：
- 查询框 + Enter 触发；结果「**原始 JSON / 格式化**」一键切换，便于排查。
- 每条结果展示 `score`（相似度%）、`rerank_score`、来源/文件ID/块索引/距离。
- `SearchConfigModal` 弹窗内嵌 `SearchConfigPanel`，**后端字段自动成表单**（含 `search_mode` 切换、`vector_weight`/`bm25_weight` 滑块、`use_reranker`/`use_graph_retrieval` 开关及其 `depend_on` 子项）。
- **示例问题生成**（`generateSampleQuestions`）：用 LLM 基于知识库生成测试查询，闭环评测前用。
- 落地建议：天枢直接照此实现「调试器组件 + 配置面板」，把第 3.2 节的检索参数 Schema 渲染出来。

### 4.2 分块策略配置 UI
`ChunkParamsConfig.vue`：分块策略下拉（复用后端 `getChunkPresets`）+ 最大 Token 数 + 重叠比例% + 分隔符（仅 QA 显示），每项带 tooltip 说明。对应天枢 02 §7，可直接复用交互。

### 4.3 chunk 详情与来源定位
`KbChunkDetailModal.vue`：弹窗展示 chunk 内容（Markdown 渲染）+ 相似度 + `chunk_id` + **行号区间**（来自 `metadata.start_line/end_line`）。这正好对应天枢 02 §6「每个 Chunk 携带 sourceAnchor，引用展示为文件名+原文件位置」。

### 4.4 对话内引用/知识结果卡片（高价值）
`QueryKbTool.vue`：Agent 调用知识库后，前端把工具结果渲染为结构化卡片：
- chunks 列表（复用 `KbResultGroupedList`）；
- 图谱卡片：实体（名称+类型+描述）、关系（`src → tgt : keywords`）、引用链接；
- 解析容错：`normalizeChunks` 兼容 `results/chunks` 两种字段，重复解析做 `lastResultContent` 缓存。
- 落地建议：天枢的角色对话引用展示直接复用「chunk 卡片 + 引用链接 + 可选图谱块」模式，且把「图谱结果」作为**可选折叠区**，避免污染主回答。

### 4.5 知识库管理 & 共享权限
- `DataBaseView.vue`：列表 + 创建弹窗 + `shareConfig`（access_level=global/department/user + department_ids/user_uids）。
- `DataBaseInfoView.vue`：文件树、`pendingParseCount`/`pendingIndexCount` 待处理计数、chunk 预设编辑、删除确认。
- 注意：Yuxi 的共享是「资源级 access_level」，而天枢是「角色 Binding + Repository 层过滤」（更细、跨会话稳定）。**两者不冲突**：天枢可保留角色 Binding 作为功能级授权，同时借鉴 Yuxi 的「知识库级共享开关」做管理员视图共享。但天枢 00 已明确「不默认注入、权限过滤在 Repository/Retrieval 层」——Yuxi 的 `check_accessible` 也落在后端，方向一致。

### 4.6 图谱/思维导图可视化（可选能力）
- `KnowledgeGraphSection.vue`：知识库类型不支持时显式提示「当前知识库类型不支持知识图谱」。
- `MindMapSection.vue`：从 KB 生成结构化思维导图，支持**增量更新 + diff 清理已删除文件**。
- 借鉴点：思维导图是 KB 的轻量增值能力；天枢二期若有余力可后置，但「类型不支持时明确降级」的 UX 值得学。

---

## 5. 知识图谱设计（边界务必厘清）

Yuxi 的图谱是**「文档知识图谱」**：从 chunk 抽取实体/三元组 → 存 Neo4j（关系）+ Milvus（向量实体/三元组）→ 查询时：
1. query 召回 top-k 实体 + top-k 三元组（`search_entities`/`search_triples`）；
2. 用 base 命中 chunk 的 `ent_ids` 一起构造 `seed_weights`（归一化）；
3. 在 2-hop 子图上跑 **Personalized PageRank**（阻尼系数可配）→ 给 chunk 打分；
4. 与向量结果用 **RRF** 融合（`graph_weight` 可调）。

**与天枢的关系（关键边界）**：
- 天枢 `00 §10` 明确：**CodeGraph / Graphify 是代码结构与调用图**，知识库是文件资料，二者不互相导入、不重复建索引。
- Yuxi 的图谱是从**文档**抽取的，本质是 KB 内部的「文档语义图」，与代码图无关。
- 结论：天枢**不应**把 Yuxi 的图谱并入 Graphify/CodeGraph。若未来要增强 KB 检索，可把「文档知识图谱 + PPR」作为**知识库 bounded context 内的可选能力**独立建设，且其检索结果仍通过 `knowledge_search` 工具返回，不污染代码图。当前二期可**暂不做图谱**，仅预留 `graph_build_config` 锁定位（Yuxi 的「图谱配置锁定后需走重置接口」是好的护栏）。

参考代码：`graphs/milvus_graph_service.py:637` `query_and_rank_chunks_by_ppr` → `rank_chunks_by_ppr`（`personalized_pagerank`），`graphs/milvus_graph_vector_store.py`，`graphs/extractors/llm.py`。

---

## 6. 评测设计（对齐天枢 03 §8）

Yuxi 已实现天枢 03 只描述未落地的指标：
- `eval/metrics.py`：`RetrievalMetrics.precision_at_k/recall_at_k/f1_score_at_k`；`AnswerMetrics.judge_correctness`（LLM Judge，1/0）。
- `eval/evaluator.py`：`evaluate_question`/`aggregate_metrics`，配合 `benchmark_generation.py` 用 LLM 生成 (query, gold_answer, relevant_ids) 数据集。
- 前端：`RAGEvaluationTab.vue`、`EvaluationBenchmarks.vue`、`evaluationApi.uploadDataset/listDatasets`。
- 借鉴点：天枢 03 §8 要求 Recall@K、MRR、引用正确率、lexical-only/向量/RRF 对比、Provider 故障演练——直接参考 Yuxi 的度量函数与「benchmark 自动生成 + 上传数据集」闭环，无需从零设计。

---

## 7. 对照天枢 00~03 逐点比对

| 天枢设计点（00~03） | 与 Yuxi 比对 | 结论 |
|---|---|---|
| 记忆/知识/代码图 三域分离（00 §3、§10） | Yuxi 把「文档图谱」并入 KB，未区分代码图 | **天枢更优，保持**。Yuxi 图谱仅作 KB 内可选能力参考 |
| 知识库独立 Schema、不共用 Memory 表（02 §2、§10） | Yuxi 的 KB 也独立（`knowledge_base_repository`/`knowledge_file_repository`/`knowledge_chunk_repository`） | 对齐，可放心采用其 Repository 分层 |
| 文件生命周期：原件不可变→版本化 Markdown→分块→FTS+向量（02 §4） | Yuxi：`parse_file→markdown(MinIO)→index_file→chunk+embed(Milvus)`，状态机完整 | 对齐，吸收其状态机+乐观锁 |
| 分块：Markdown 标题层级、500–900 token、重叠（02 §7） | Yuxi：6 类预设 + token/重叠/分隔符 + `chunk_engine_version` | **借鉴预设机制**扩展天枢单一种类 |
| 检索：BM25+向量+RRF、lexical-only 降级（02 §8） | Yuxi：vector/keyword/hybrid + `WeightedRanker` + 图谱 RRF | 对齐，参考其实现 |
| 引用：sourceAnchor 回原文件位置（02 §6） | Yuxi：`chunk_id`+`start_char_pos/end_char_pos`+`file_id`；前端显示行号/来源 | 对齐，复用前端引用卡 |
| 权限：Binding + Repository 层过滤（03 §3） | Yuxi：`share_config(access_level)` + `check_accessible` 后端过滤 | 方向一致；天枢 Binding 更细，可叠加「库级共享开关」 |
| 删除覆盖文件/FTS/向量/缓存/Binding（03 §6） | Yuxi：`delete_file`→删 chunk→删 Milvus→删图→删元数据；`detect_data_inconsistencies` | 对齐，吸收一致性检测 |
| 评测：Recall@K/MRR/引用正确率（03 §8） | Yuxi：已实现 Recall@K/F1/LLM Judge + benchmark | **直接复用**其度量与 UI |
| 前端：拖拽上传/版本/检索调试/引用预览（02 §11） | Yuxi：完整实现（详见第 4 节） | 天枢前端为占位，**高优先借鉴** |
| 不默认注入、动态工具结果在固定前缀之后（00 §11） | Yuxi：知识库经 middleware 挂为工具，结果进 Tool Message | 对齐 |

---

## 8. 差异与风险提示

1. **重依赖差异**：Yuxi 依赖 Milvus + Neo4j + MinIO + Redis + Postgres，对天枢「Windows 安装包/轻量部署」偏重。天枢 02 倾向 FTS5/BM25 + 向量 + SQLite 兜底。**不要直接引入 Milvus**；借鉴其「LITE 模式跳过重依赖」「lexical-only 降级」的设计哲学，而非具体组件。具体轻量替代方案见第 9 节。
2. **共享模型不同**：Yuxi 是「资源 access_level 共享」；天枢是「角色 Binding + 跨会话稳定」。天枢勿退化为单纯全局共享，保持现有权限语义（可加库级共享作为管理员便利）。
3. **图谱语义不同**：Yuxi 图谱=文档语义图；天枢 Graphify/CodeGraph=代码图。见第 5 节，**禁止并入代码图**。
4. **Agent 运行时耦合**：Yuxi 知识库经 LangGraph middleware 挂载工具。天枢有独立 Agent Loop，应只复用「知识工具返回结构（chunk+引用）」，不照搬其 LangGraph 装配。
5. **多租户 vs 单用户/组**：Yuxi 是企业多租户（department/user 维度）。天枢当前是角色/组模型，吸收其 `share_config` 思路即可，不必引入完整租户体系。

---

## 9. 轻量替代架构（FTS5 优先，不引入重服务）

针对「向量库是否过重」的疑问，给出明确结论与可落地替代。

**核心判断**：对天枢「Windows 桌面 / 单用户 / 可能离线 / 中小语料」的现状，常驻 Milvus + Neo4j 是过度工程。向量检索的真正价值仅在「语义 / 改写 / 跨语言召回」场景；而手册、规格、FAQ、代码这类关键词明确、结构清晰的知识，FTS5/BM25 往往已足够，且更快、更透明、更便宜、天然离线。

**推荐三层栈（均零独立服务）**
1. **FTS5(BM25) 常驻主力**：SQLite 内置全文索引，作为 02 设计里「Provider 故障走 lexical-only」的**默认常驻**检索，而非兜底。负责精确匹配、规格、代码、文件名等。
2. **本地向量作可关增强**：仅在需要语义召回时启用——用本地小模型 embedding（如 bge-small）在 SQLite 内存储向量（sqlite-vec / 原生 blob），不单独起向量服务；关闭即纯 FTS5。对应 02 的「可配置 Embedding 向量召回」。
3. **LLM wiki/导图作导航层**：用 LLM 把资料抽取成结构化 wiki 页 / 摘要 / 思维导图（类似 Yuxi MindMap），让 Agent 能「按结构导航」，减少暴力检索——它是**索引 / 导航层，不是检索替代**；大语料下仍由 FTS5/向量兜底。

**明确不做**
- 不默认引入 Milvus / Qdrant / Weaviate 等独立向量服务。
- 不引入 Neo4j 图数据库；文档图谱（若二期之后要做 PPR 增强）用 SQLite 存三元组即可。
- 不把「llmwiki 思路」当成唯一检索手段（纯 in-context 仅适合极小语料；纯 LLM 整理会丢失语义召回）。

**与 Yuxi 的差异总结**：Yuxi 用 Milvus+Neo4j 解决「企业多租户大规模 RAG」；天枢应取其「配置驱动 UI、状态机、分块预设、引用卡片、评测」等**思路与交互**，而把其**重依赖组件替换为 SQLite+FTS5+本地向量的轻量等价物**。落地优先级见第 10 节。

---

## 10. 落地建议（按优先级，轻量优先）

**P0（二期必做，轻量基线 + 借鉴交互/结构）**
- **FTS5(BM25) 常驻检索为默认**：SQLite 内置全文索引，零基建、可离线、适配 Windows 安装包；作为主力而非兜底（第 9 节）。
- 检索参数 Schema + 配置驱动 UI（第 3.2 节）：后端声明 `query_params` 元数据 → `/query_params` 暴露 → 前端通用渲染；默认模式即 FTS5-only。
- 文件状态机 + 乐观锁 claim（第 3.6 节）用于异步 parse/index。
- 前端：检索调试器（QuerySection，默认 FTS5-only + 「启用本地向量（可选）」开关）、chunk 详情与行号引用（KbChunkDetailModal）、对话内引用卡片（QueryKbTool）。
- 解析器注册表 + 统一入口（第 3.4 节），补齐 docx/xlsx/pptx/pdf。

**P1（增强，均为可关开关）**
- **本地向量检索（可选）**：本地小模型 embedding + SQLite 内向量（sqlite-vec / 原生 blob），不引入独立向量服务；关闭即纯 FTS5（第 9 节）。
- 分块预设机制（general/qa/book/laws/semantic/separator）+ 三级参数合并 + `chunk_engine_version`（第 3.5 节）。
- 检索融合：FTS5 为主，开启本地向量后做 RRF 融合（第 3.3 节思路，对齐 02 §8），reranker 作为可关精排。
- 知识库级共享开关（access_level）叠加在角色 Binding 之上（第 4.5 节）。
- LLM wiki/导图导航层（第 4.6 节 MindMap 思路）：建结构化索引辅助导航，不替代检索。

**P2（二期之后可选）**
- 文档知识图谱 + PPR 增强检索（第 5 节），**仅用 SQLite 存三元组**，不引入 Neo4j。
- 思维导图生成 + 增量 diff（第 4.6 节）。
- 评测套件：Recall@K/F1/LLM Judge + benchmark 生成（第 6 节），落地 03 §8；评测需覆盖「纯 FTS5」「FTS5+本地向量」两档。
- 一致性检测与修复脚本（第 3.7 节）。

---

## 11. 参考文件清单（已核实）

后端：
- `backend/package/yuxi/knowledge/manager.py`（分发/权限/一致性）
- `backend/package/yuxi/knowledge/factory.py`、`base.py`、`schemas.py`、`runtime.py`
- `backend/package/yuxi/knowledge/implementations/milvus.py`（检索配置 `MilvusRetrievalConfig:83`、融合 `aquery:894`、RRF `_fuse_chunk_rankings:1193`、索引 `index_file:647`）
- `backend/package/yuxi/knowledge/chunking/ragflow_like/{presets,dispatcher}.py`
- `backend/package/yuxi/knowledge/parser/{factory,registry,unified,base}.py`
- `backend/package/yuxi/knowledge/graphs/milvus_graph_service.py`（PPR `:637`）
- `backend/package/yuxi/knowledge/eval/{metrics,evaluator}.py`

前端：
- `web/src/views/DataBaseView.vue`、`DataBaseInfoView.vue`
- `web/src/components/SearchConfigModal.vue`、`SearchConfigPanel.vue`
- `web/src/components/QuerySection.vue`、`ChunkParamsConfig.vue`
- `web/src/components/sources/KbChunkDetailModal.vue`、`KbResultGroupedList.vue`
- `web/src/components/ToolCallingResult/tools/QueryKbTool.vue`
- `web/src/components/MindMapSection.vue`、`KnowledgeGraphSection.vue`
- `web/src/apis/knowledge_api.js`

天枢对照：
- `知识体系构建/00-知识体系总体设计.md`、`01-第一期-角色私有记忆与跨会话机制.md`、`02-第二期-独立文件知识库.md`、`03-第三期-权限治理与整体验收.md`、`README.md`

---

*备注：本分析为静态代码走读，未运行 Yuxi（需 Docker 全栈）。涉及具体算法参数（权重、top_k、阻尼系数）的建议值以天枢自身评测为准，Yuxi 默认值仅作起点参考。*
