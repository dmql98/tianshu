# Graph Report - dev  (2026-08-12)

## Corpus Check
- 308 files · ~235,482 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1720 nodes · 3547 edges · 142 communities (106 shown, 36 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.69)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b09d9c68`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- chatStore.ts
- dependencies
- SkillSettings.vue
- EventsView.vue
- dependencies
- chat.ts
- toolStore.ts
- index.ts
- RoleSettings.vue
- outer.ts
- package.json
- offlineMiner.ts
- EvolutionSettings.vue
- ModelSelector.vue
- inner.ts
- apiGet
- WorkspacePicker.vue
- tools.ts
- compilerOptions
- useChatStore
- system-cache.ts
- characterStore.ts
- loop.test.ts
- eventExecutor.ts
- EventsPage.tsx
- apiGet
- loop.test.ts
- SettingsPage.tsx
- goals.ts
- index.ts
- context-builder.ts
- tools.ts
- ChatInput.tsx
- checkpoint-store.ts
- Sidebar.vue
- ToolBindingEditor.vue
- attachments.ts
- cronRegistry.ts
- validate.ts
- CharacterSelector.vue
- InputToolbar.vue
- MessageItem.vue
- sub-agent.ts
- matchers.ts
- ProviderSettings.vue
- client.ts
- skill-loader.ts
- context-compactor.ts
- context-references.ts
- providerStore.ts
- goals.ts
- types.ts
- utils.ts
- registry.ts
- compilerOptions
- MarkdownRenderer.vue
- GeneralEventSettings.vue
- sessions.ts
- compose.ts
- App.tsx
- ProviderPlugin
- index.ts
- run-store.ts
- session-runner.ts
- DisplaySettings.vue
- toolStore.ts
- index.ts
- 弈 (Yì) — AI Agent 系统
- presence-projector.ts
- definitions.ts
- AvatarCropDialog.tsx
- approval-registry.ts
- providerStore.ts
- llm-logger.ts
- config.ts
- normalize-skill-frontmatter.mjs
- server-manager.ts
- errors.ts
- asset-gc.ts
- smoke-packaged.mjs
- useProvidersStore
- index.ts
- copy-tool-json.js
- main.ts
- package.json
- electron.d.ts
- AGENTS.md
- providersStore.ts
- workspace.ts
- media-store.ts
- scripts
- verify-release-version.mjs
- preload.ts
- anthropic.ts
- cloudflare-ai-gateway.ts
- cloudflare-workers-ai.ts
- cohere.ts
- deepinfra.ts
- deepseek.ts
- gateway.ts
- github-copilot.ts
- gitlab.ts
- google-vertex.ts
- groq.ts
- kilo.ts
- nvidia.ts
- openai.ts
- openai-compatible.ts
- opencode-go.ts
- openrouter.ts
- perplexity.ts
- siliconflow.ts
- togetherai.ts
- vercel.ts
- xai.ts
- xiaomi.ts
- index.ts
- @hono/node-server
- htmlparser2
- iconv-lite
- jsdom
- run-store.ts
- control-router.ts
- sub-agent.ts
- toolStore.ts
- definitions.ts
- checkpoint-store.ts
- 7. 初始化与切换流程
- avatarCropStyle
- Provider Catalog 图标许可证与来源记录
- 4. 产品范围建议
- 6. 主题 Token 设计
- 8. UI 开发计划
- 3. 天枢当前状态

## God Nodes (most connected - your core abstractions)
1. `getDataDir()` - 52 edges
2. `apiPost()` - 39 edges
3. `apiGet()` - 38 edges
4. `ProviderPlugin` - 36 edges
5. `sessionLoop()` - 33 edges
6. `getDb()` - 33 edges
7. `SettingsPage()` - 22 edges
8. `runLoopEngine()` - 21 edges
9. `LLMMessage` - 20 edges
10. `fetchCharacters()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `streamWithRetry()` --indirect_call--> `chunk()`  [INFERRED]
  web/server/src/agent/inner.ts → desktop/scripts/gen-icon.mjs
- `connectMCPServer()` --indirect_call--> `chunk()`  [INFERRED]
  web/server/src/tools/mcp-client.ts → desktop/scripts/gen-icon.mjs
- `startTianshuServer()` --references--> `server`  [EXTRACTED]
  web/server/src/app.ts → scripts/dev-desktop.mjs
- `broadcastSocket()` --references--> `server`  [EXTRACTED]
  web/server/src/routes/goals.ts → scripts/dev-desktop.mjs
- `broadcastSocket()` --references--> `server`  [EXTRACTED]
  web/server/src/routes/runs.ts → scripts/dev-desktop.mjs

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (142 total, 36 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): better-sqlite3, hono, @modelcontextprotocol/sdk, @mozilla/readability, socket.io, turndown, dependencies, better-sqlite3 (+7 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.10
Nodes (31): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), CharacterPresence, characterPresenceProjector (+23 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.05
Nodes (40): 10. 图标导入要求, 11.1 Catalog loader 单元测试, 11.2 API 测试, 11.3 客户端测试, 11.4 集成验证, 11. 测试计划, 12. 验收标准, 13. 推荐实施顺序 (+32 more)

### Community 4 - "dependencies"
Cohesion: 0.24
Nodes (10): createSkillPackage(), fetchSkillChild(), fetchSkillPackage(), SkillChildDetail, SkillFile, SkillPackageChild, SkillPackageDetail, SkillPackageMeta (+2 more)

### Community 5 - "chat.ts"
Cohesion: 0.20
Nodes (8): browseDirectory(), BrowseResult, DirEntry, openInFileManager(), resolvePath(), Props, ProjectContextMenu, SessionPanel()

### Community 6 - "toolStore.ts"
Cohesion: 0.08
Nodes (24): author, dependencies, electron-updater, description, devDependencies, electron, electron-builder, @types/node (+16 more)

### Community 7 - "index.ts"
Cohesion: 0.11
Nodes (19): children, CLIENT_PORT, clientDir, desktopDir, devRoot, __dirname, electron, electronPath (+11 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.16
Nodes (12): mcpServerStore, router, TOOLS_DIR, classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), MCPServerConfig, MCPToolDef (+4 more)

### Community 9 - "outer.ts"
Cohesion: 0.10
Nodes (34): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+26 more)

### Community 10 - "package.json"
Cohesion: 0.12
Nodes (21): CacheEntry, CatalogIssue, CatalogLoadResult, __dirname, getCatalogRoot(), getIconPath(), getPreset(), isIconInsideDir() (+13 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.12
Nodes (20): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+12 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.12
Nodes (20): cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunRow, submitRunInput(), connectSocket(), AskUserDialog(), applyRunEvents() (+12 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.19
Nodes (16): CharacterVisual, saveCharacterVisual(), uploadCharacterAsset(), AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog() (+8 more)

### Community 14 - "inner.ts"
Cohesion: 0.11
Nodes (29): createDurableSocket(), PHASE_BY_EVENT, publishRunEvent(), RAW_SOCKET, RunEventRow, runEventStore, terminalStatus(), unwrapDurableSocket() (+21 more)

### Community 15 - "apiGet"
Cohesion: 0.17
Nodes (19): deleteCharacter(), apiDelete(), apiGet(), apiPost(), deleteProvider(), fetchProviderModels(), fetchProviders(), ProviderModel (+11 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.29
Nodes (6): capMessage(), clampPercent(), toMessage(), UpdateManager, UpdateManagerOptions, UpdateState

### Community 17 - "tools.ts"
Cohesion: 0.15
Nodes (8): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions, runStore

### Community 18 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+15 more)

### Community 19 - "useChatStore"
Cohesion: 0.14
Nodes (21): characterAssetUrl(), CharacterMotionBinding, createCharacter(), exportCharacterPackage(), fetchCharacter(), fetchCharacterStats(), importCharacterPackage(), publishCharacterRevision() (+13 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.18
Nodes (11): ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), isCompact(), MessageList() (+3 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.32
Nodes (11): configPath(), ensureMcpDir(), findById(), findDirById(), MCP_DIR(), MCPServerRecord, migrateFromOldFile(), OLD_FILE() (+3 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.33
Nodes (5): messageStore, providerStore, sessionStore, router, router

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (18): archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences() (+10 more)

### Community 25 - "apiGet"
Cohesion: 0.14
Nodes (19): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, handleAskUser(), handleCreatePlan() (+11 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.42
Nodes (10): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+2 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.14
Nodes (30): apiPut(), reloadDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+22 more)

### Community 28 - "goals.ts"
Cohesion: 0.22
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.29
Nodes (6): fetchCharacterPresence(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 30 - "context-builder.ts"
Cohesion: 0.22
Nodes (8): 10. Dream Skin 风格装饰主题阶段, 11. 第三方主题的后续边界, 14. 验收标准, 15. 推荐实施顺序, 16. 开发约束, 1. 目标, 5. 目标数据模型, 天枢主题切换开发计划

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.27
Nodes (10): CHAR_DIR(), CharacterMemory, ensureCharDir(), normalizeRecord(), pathFor(), readAll(), removeDir(), SkillBinding (+2 more)

### Community 33 - "checkpoint-store.ts"
Cohesion: 0.39
Nodes (8): Config, configFilePath(), __dirname, isConfigured(), legacyHasData(), loadConfig(), setDataDir(), writeConfig()

### Community 34 - "Sidebar.vue"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, lib, module, moduleResolution, outDir, rootDir, skipLibCheck (+8 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.13
Nodes (25): CLAUDE_SPEC, collect(), configPaths(), CURSOR_SPEC, dedupe(), discoverClaudeServers(), discoverCursorServers(), DiscoveredMCPServer (+17 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.20
Nodes (9): ALLOWED_TRANSITIONS, RunRow, RunStatus, TERMINAL, CharacterBinding, resolveCharacterBinding(), ResolvedCharacterBinding, CharacterRevisionRow (+1 more)

### Community 38 - "validate.ts"
Cohesion: 0.09
Nodes (12): tool, tool, fuzzySuggest(), similarity(), tool, coerceBoolean, coerceNumber, validate() (+4 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.16
Nodes (16): DEV_CORS_ORIGINS, isLoopbackOrigin(), MIME, serveClientHandler(), StartServerOptions, startTianshuServer(), TianshuServer, stopAssetGC() (+8 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.10
Nodes (33): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), InnerResult, matchToolCall(), READ_ONLY_TOOLS (+25 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.20
Nodes (4): fetchDataspace(), App(), navItems, KnowledgePage()

### Community 42 - "sub-agent.ts"
Cohesion: 0.12
Nodes (16): engines, node, name, private, scripts, build, build:client, build:desktop (+8 more)

### Community 43 - "matchers.ts"
Cohesion: 0.29
Nodes (11): collapseWhitespace(), contextAwareMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers, MatchResult, normalizeLineEndings() (+3 more)

### Community 45 - "client.ts"
Cohesion: 0.17
Nodes (14): assetsDir, chunk(), clamp(), crc32(), CRC_TABLE, __dirname, drawIcon(), encodePNG() (+6 more)

### Community 46 - "skill-loader.ts"
Cohesion: 0.09
Nodes (39): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+31 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.13
Nodes (15): tsx, @types/better-sqlite3, @types/glob, @types/jsdom, @types/turndown, devDependencies, tsx, @types/better-sqlite3 (+7 more)

### Community 48 - "context-references.ts"
Cohesion: 0.05
Nodes (39): markdown-it, react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite (+31 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 50 - "goals.ts"
Cohesion: 0.44
Nodes (8): DATA_DIR(), ensureDataDir(), ensureIds(), FILE(), ModelInfo, ProviderRecord, readAll(), writeAll()

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (5): plugin, plugin, plugin, pluginIndex, plugins

### Community 52 - "utils.ts"
Cohesion: 0.21
Nodes (14): scanCommandPaths(), tool, exactMatch(), findBestMatch(), assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin() (+6 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 56 - "GeneralEventSettings.vue"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 57 - "sessions.ts"
Cohesion: 0.33
Nodes (3): db, NOW, tmpData

### Community 58 - "compose.ts"
Cohesion: 0.14
Nodes (10): ComposeContext, composeMessages(), lastUserIdx(), messages, regular, thinking, LLMOptions, LLMUsage (+2 more)

### Community 59 - "App.tsx"
Cohesion: 0.24
Nodes (15): server, EventDefinitionRow, eventDefinitionStore, broadcastSocket(), drainQueue(), executeOccurrence(), scheduleOccurrence(), claimDue() (+7 more)

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat, plugin

### Community 62 - "run-store.ts"
Cohesion: 0.15
Nodes (15): tool, parseSkillNames(), parsed, toolBindings, updated, updateNamedBindings(), updateSkillNames(), tool (+7 more)

### Community 65 - "toolStore.ts"
Cohesion: 0.33
Nodes (7): defaults, ensureDataDir(), EvolutionConfig, FILE(), read(), write(), router

### Community 66 - "index.ts"
Cohesion: 0.14
Nodes (12): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+4 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (13): assertInsideDesktop(), cacheDir, desktopDir, devRoot, __dirname, download(), ensureDownloaded(), log() (+5 more)

### Community 69 - "definitions.ts"
Cohesion: 0.10
Nodes (30): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderCapability (+22 more)

### Community 71 - "approval-registry.ts"
Cohesion: 0.13
Nodes (21): CharacterAssetRef, CharacterMotion, CharacterVisualResponse, fetchCharacters(), fetchCharacterVisual(), updateSession(), fetchSkillPackages(), CharacterPicker() (+13 more)

### Community 72 - "providerStore.ts"
Cohesion: 0.12
Nodes (17): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars(), LLMChunk, collect(), lastOf(), main() (+9 more)

### Community 73 - "llm-logger.ts"
Cohesion: 0.31
Nodes (7): DesktopAppInfo, UpdatePhase, formatBytes(), formatSpeed(), UpdatePanel(), DISABLED, useDesktopUpdater()

### Community 74 - "config.ts"
Cohesion: 0.13
Nodes (18): MessageItem(), Props, showReasoning(), ContextMenu, icons, Props, ChatState, Event (+10 more)

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

### Community 76 - "server-manager.ts"
Cohesion: 0.27
Nodes (5): ServerManagerOptions, fixtures, DesktopMessage, ServerMessage, serverRoot

### Community 77 - "errors.ts"
Cohesion: 0.29
Nodes (7): 12. 分阶段实施任务, P0：测试先行与现状基线, P1：主题核心, P1：核心页面 Token 化, P1：设置页与快捷入口, P2：全部页面与装饰主题, P3：可选主题包

### Community 78 - "asset-gc.ts"
Cohesion: 0.29
Nodes (7): 2.1 它解决的问题与天枢不同, 2.2 主题契约, 2.3 CSS 变量与公开部件, 2.4 自适应背景与可读性, 2.5 保存、应用与回滚, 2.6 不应照搬的部分, 2. Codex Dream Skin 研究结论

### Community 79 - "smoke-packaged.mjs"
Cohesion: 0.25
Nodes (6): child, dataDir, [nodeExe, stagingServer, clientDist], sqlite, timeout, ver

### Community 81 - "index.ts"
Cohesion: 0.32
Nodes (4): hasBOM(), stripBOM(), tool, dir

### Community 82 - "copy-tool-json.js"
Cohesion: 0.50
Nodes (3): dest, __dirname, src

### Community 83 - "main.ts"
Cohesion: 0.33
Nodes (3): logUpdater(), registerIpc(), updaterLogFile()

### Community 84 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 87 - "providersStore.ts"
Cohesion: 0.19
Nodes (13): createProvider(), fetchBuiltinProviders(), ProviderPreset, updateProvider(), AddProviderDialog(), formatLabel, Props, EditProviderDialog() (+5 more)

### Community 88 - "workspace.ts"
Cohesion: 0.29
Nodes (6): Provider 预设目录（Provider Catalog）, 协议, 图标, 排序, 构建与打包, 运行时校验

### Community 89 - "media-store.ts"
Cohesion: 0.48
Nodes (6): AttachmentMeta, deleteSessionMedia(), extFor(), loadAttachmentBase64(), MEDIA_DIR(), saveAttachment()

### Community 90 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, start, test

### Community 91 - "verify-release-version.mjs"
Cohesion: 0.50
Nodes (3): desktopPkg, devRoot, __dirname

### Community 94 - "cloudflare-ai-gateway.ts"
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

### Community 116 - "index.ts"
Cohesion: 0.33
Nodes (6): 13.1 单元测试, 13.2 组件测试, 13.3 手工与浏览器视觉测试, 13.4 可访问性, 13.5 构建验证, 13. 测试计划

### Community 128 - "run-store.ts"
Cohesion: 0.40
Nodes (5): copyAsset(), dest, __dirname, src, walk()

### Community 129 - "control-router.ts"
Cohesion: 0.14
Nodes (20): evaluateSubmission(), SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, handleSubAgentRequest(), handleTaskComplete(), SubAgentOutcome, SubmitResultOutcome (+12 more)

### Community 130 - "sub-agent.ts"
Cohesion: 0.20
Nodes (13): getDataDir(), DEBUG_DIR(), deleteOldDebugSessions(), mergeOldDebugTurns(), mergeContent(), DEFAULT_PROMPT_FILE(), router, DEBUG_DIR() (+5 more)

### Community 131 - "toolStore.ts"
Cohesion: 0.83
Nodes (3): DEBUG_DIR(), logLLMCall(), systemPromptFingerprint()

### Community 132 - "definitions.ts"
Cohesion: 0.15
Nodes (17): getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints(), executeTool() (+9 more)

### Community 133 - "checkpoint-store.ts"
Cohesion: 0.47
Nodes (4): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore

### Community 134 - "7. 初始化与切换流程"
Cohesion: 0.40
Nodes (5): 7.1 启动前初始化, 7.2 运行时切换, 7.3 跟随系统, 7.4 跨窗口同步, 7. 初始化与切换流程

### Community 135 - "avatarCropStyle"
Cohesion: 0.40
Nodes (5): 9. CSS 与组件改造范围, P0：Token 审计, P1：核心页面, P2：管理页面, 硬编码整改重点

### Community 136 - "Provider Catalog 图标许可证与来源记录"
Cohesion: 0.40
Nodes (4): Provider Catalog 图标许可证与来源记录, 商标声明, 来源, 许可证

### Community 137 - "4. 产品范围建议"
Cohesion: 0.50
Nodes (4): 4.1 首版内置主题, 4.2 入口, 4.3 装饰背景规则, 4. 产品范围建议

### Community 138 - "6. 主题 Token 设计"
Cohesion: 0.50
Nodes (4): 6.1 分层原则, 6.2 作用域, 6.3 文字颜色与主题的优先级, 6. 主题 Token 设计

### Community 139 - "8. UI 开发计划"
Cohesion: 0.50
Nodes (4): 8.1 设置页, 8.2 导航快捷切换, 8.3 主题预览, 8. UI 开发计划

### Community 140 - "3. 天枢当前状态"
Cohesion: 0.67
Nodes (3): 3.1 已存在的代码, 3.2 当前缺陷, 3. 天枢当前状态

## Knowledge Gaps
- **503 isolated node(s):** `name`, `version`, `description`, `author`, `private` (+498 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `stableJson()` connect `registry.ts` to `SkillSettings.vue`?**
  _High betweenness centrality (0.330) - this node is a cross-community bridge._
- **Why does `FilePanel()` connect `system-cache.ts` to `registry.ts`?**
  _High betweenness centrality (0.215) - this node is a cross-community bridge._
- **Why does `MemoryStorage` connect `registry.ts` to `SettingsPage.tsx`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _503 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `SkillSettings.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.10128205128205128 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._