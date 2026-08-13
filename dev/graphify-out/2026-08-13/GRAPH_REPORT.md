# Graph Report - dev  (2026-08-12)

## Corpus Check
- 326 files · ~256,328 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1986 nodes · 4092 edges · 157 communities (120 shown, 37 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c1e6a0bf`
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
- workspace.ts
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
- getDb
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
- evolutionConfig.ts
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
- streamWithRetry
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
- llm-logger.ts
- index.ts
- definitions.ts
- checkpoint-store.ts
- 7. 初始化与切换流程
- avatarCropStyle
- Provider Catalog 图标许可证与来源记录
- 4. 进展判定
- 6. 主题 Token 设计
- 5. Run 内动态收敛
- 9. 自动续跑策略
- 10. 取消、并发与 parked 状态
- 3. 限额模型
- 6. 持久化模型
- edit.integration.test.ts
- truncate.ts
- revision-stale.test.ts
- streamChatCompletion
- revision-store.ts
- @hono/node-server
- types.ts
- plan-store.ts
- loop.test.ts
- evolutionConfig.ts
- workspace.ts
- jsdom

## God Nodes (most connected - your core abstractions)
1. `getDataDir()` - 56 edges
2. `apiPost()` - 41 edges
3. `sessionLoop()` - 41 edges
4. `apiGet()` - 40 edges
5. `getDb()` - 39 edges
6. `ProviderPlugin` - 36 edges
7. `runLoopEngine()` - 26 edges
8. `SettingsPage()` - 22 edges
9. `TianShu 运行策略、动态收敛与自动续跑开发交接文档` - 22 edges
10. `TianShu 内置内容与用户数据分层开发计划` - 21 edges

## Surprising Connections (you probably didn't know these)
- `streamWithRetry()` --indirect_call--> `chunk()`  [INFERRED]
  web/server/src/agent/inner.ts → desktop/scripts/gen-icon.mjs
- `connectMCPServer()` --indirect_call--> `chunk()`  [INFERRED]
  web/server/src/tools/mcp-client.ts → desktop/scripts/gen-icon.mjs
- `createResumedRun()` --indirect_call--> `run()`  [INFERRED]
  web/server/src/agent/runtime/run-resume-service.ts → scripts/prepare-desktop-runtime.mjs
- `startTianshuServer()` --references--> `server`  [EXTRACTED]
  web/server/src/app.ts → scripts/dev-desktop.mjs
- `broadcastSocket()` --references--> `server`  [EXTRACTED]
  web/server/src/routes/goals.ts → scripts/dev-desktop.mjs

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (157 total, 37 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): better-sqlite3, hono, @modelcontextprotocol/sdk, @mozilla/readability, socket.io, turndown, dependencies, better-sqlite3 (+7 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.13
Nodes (19): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, assetDir(), assetIndexPath(), CharacterAssetKind, CharacterAssetRef (+11 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.07
Nodes (42): Appearance, BackgroundSource, BUILTIN_IDS, BUILTIN_THEME_NIGHT, BUILTIN_THEME_PAPER, BUILTIN_THEMES, clamp(), isBuiltinThemeId() (+34 more)

### Community 4 - "dependencies"
Cohesion: 0.11
Nodes (16): createSkillPackage(), fetchSkillChild(), fetchSkillPackage(), fetchSkillPackages(), SkillChildDetail, SkillFile, SkillPackageChild, SkillPackageDetail (+8 more)

### Community 5 - "chat.ts"
Cohesion: 0.04
Nodes (48): 10. 前端模块建议, 11. CSS 与组件改造范围, 12. 分阶段实施, 13.1 客户端单元测试, 13.2 服务端测试, 13.3 组件和端到端测试, 13.4 视觉和可访问性矩阵, 13.5 构建验证 (+40 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.08
Nodes (24): author, dependencies, electron-updater, description, devDependencies, electron, electron-builder, @types/node (+16 more)

### Community 7 - "index.ts"
Cohesion: 0.11
Nodes (19): children, CLIENT_PORT, clientDir, desktopDir, devRoot, __dirname, electron, electronPath (+11 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.53
Nodes (5): classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), MCPServerConfig, MCPToolDef

### Community 9 - "outer.ts"
Cohesion: 0.10
Nodes (34): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+26 more)

### Community 10 - "package.json"
Cohesion: 0.08
Nodes (31): DATA_DIR(), ensureDataDir(), ensureIds(), FILE(), ModelInfo, ProviderRecord, providerStore, readAll() (+23 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.12
Nodes (20): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+12 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.13
Nodes (18): ActiveRunPhase, applyRunEvents(), Attachment, handleAutoSuccessorQueued(), handleContinuationQueued(), handleTerminalForContinuation(), initPersistentListeners(), loadPersistedDefaults() (+10 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.08
Nodes (48): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterMotionBinding, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacterPresence() (+40 more)

### Community 14 - "inner.ts"
Cohesion: 0.26
Nodes (11): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), characterVisualStore, messageStore (+3 more)

### Community 15 - "apiGet"
Cohesion: 0.29
Nodes (9): getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), validateByRule(), validateConstraints(), getAll(), ToolConstraint (+1 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.35
Nodes (6): capMessage(), clampPercent(), toMessage(), UpdateManager, UpdateManagerOptions, UpdateState

### Community 17 - "tools.ts"
Cohesion: 0.17
Nodes (7): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions

### Community 18 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+15 more)

### Community 19 - "useChatStore"
Cohesion: 0.17
Nodes (15): createCharacter(), fetchCharacter(), fetchCharacterStats(), updateCharacter(), updateCharacterSkillBinding(), EditFieldProps, dedupeToolBindings(), getUnboundTools() (+7 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.20
Nodes (11): ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), isCompact(), MessageList() (+3 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.31
Nodes (8): getDataDir(), DEBUG_DIR(), deleteOldDebugSessions(), mergeOldDebugTurns(), DEFAULT_PROMPT_FILE(), router, DEBUG_DIR(), tool

### Community 22 - "loop.test.ts"
Cohesion: 0.83
Nodes (3): DEBUG_DIR(), logLLMCall(), systemPromptFingerprint()

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.13
Nodes (29): deleteCharacter(), apiDelete(), apiPost(), archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition (+21 more)

### Community 25 - "apiGet"
Cohesion: 0.13
Nodes (28): handleAskUser(), handleCreatePlan(), handleUpdatePlanStep(), buildLimitSummary(), isReasoningModel(), LoopEngineResult, persistComposeChanges(), planStepChanged() (+20 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.42
Nodes (10): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+2 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.12
Nodes (33): apiPut(), fetchDataspace(), reloadDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig() (+25 more)

### Community 28 - "goals.ts"
Cohesion: 0.22
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.22
Nodes (10): InnerResult, buildInvalidToolCall(), CanonicalToolCall, NormalizeFailure, NormalizeResult, normalizeToolCalls(), parseArgs(), safeSnippet() (+2 more)

### Community 30 - "context-builder.ts"
Cohesion: 0.04
Nodes (47): 10.1 格式, 10.2 Catalog, 10.3 写入, 10. 技能改造, 11. Provider 预设边界, 12. API 与 UI, 13. 版本升级规则, 14. 构建与 Electron 打包 (+39 more)

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.17
Nodes (12): AutoContinuationPref, normalizeCharacterRunPolicy(), toBool(), toInt(), resolveRunPolicyArgs(), tool, parseSkillNames(), parsed (+4 more)

### Community 33 - "workspace.ts"
Cohesion: 0.20
Nodes (8): browseDirectory(), BrowseResult, DirEntry, openInFileManager(), resolvePath(), Props, ProjectContextMenu, SessionPanel()

### Community 34 - "Sidebar.vue"
Cohesion: 0.12
Nodes (16): compilerOptions, esModuleInterop, lib, module, moduleResolution, outDir, rootDir, skipLibCheck (+8 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.07
Nodes (43): configPath(), ensureMcpDir(), findById(), findDirById(), MCP_DIR(), MCPServerRecord, mcpServerStore, migrateFromOldFile() (+35 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.11
Nodes (31): server, createDurableSocket(), publishRunEvent(), unwrapDurableSocket(), abortSession(), enqueueRun(), getQueueLength(), getRunState() (+23 more)

### Community 38 - "validate.ts"
Cohesion: 0.10
Nodes (9): tool, tool, coerceBoolean, coerceNumber, validate(), ValidationError, tool, turndown (+1 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.15
Nodes (17): recoverContinuationState(), DEV_CORS_ORIGINS, isLoopbackOrigin(), MIME, serveClientHandler(), StartServerOptions, startTianshuServer(), TianshuServer (+9 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.13
Nodes (25): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), outcomeKindFor(), READ_ONLY_TOOLS (+17 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.18
Nodes (15): fetchRunPolicy(), resetRunPolicy(), saveRunPolicy(), SystemRunPolicyResponse, num(), Props, SystemRunPolicySettings(), AutoContinuationPref (+7 more)

### Community 42 - "sub-agent.ts"
Cohesion: 0.12
Nodes (16): engines, node, name, private, scripts, build, build:client, build:desktop (+8 more)

### Community 43 - "matchers.ts"
Cohesion: 0.23
Nodes (9): contextAwareMatch(), exactMatch(), findBestMatch(), levenshtein(), matchers, MatchResult, normalizeLineEndings(), ResolvedMatch (+1 more)

### Community 45 - "client.ts"
Cohesion: 0.17
Nodes (14): assetsDir, chunk(), clamp(), crc32(), CRC_TABLE, __dirname, drawIcon(), encodePNG() (+6 more)

### Community 46 - "skill-loader.ts"
Cohesion: 0.09
Nodes (38): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+30 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.13
Nodes (15): tsx, @types/better-sqlite3, @types/glob, @types/jsdom, @types/turndown, devDependencies, tsx, @types/better-sqlite3 (+7 more)

### Community 48 - "context-references.ts"
Cohesion: 0.06
Nodes (33): react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+25 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 50 - "getDb"
Cohesion: 0.11
Nodes (20): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore, forceCancelRun(), forceCancelSessionRuns(), isTerminalStatus(), PHASE_BY_EVENT (+12 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (5): plugin, plugin, plugin, pluginIndex, plugins

### Community 52 - "utils.ts"
Cohesion: 0.25
Nodes (12): scanCommandPaths(), tool, assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin(), normalizePathForPlatform(), realRoot() (+4 more)

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
Nodes (15): ContextMenu, ChatState, CharacterRunPolicyView, Event, ProviderModel, REASON_LABELS, RunLimitReason, Session (+7 more)

### Community 59 - "App.tsx"
Cohesion: 0.32
Nodes (11): EventDefinitionRow, eventDefinitionStore, drainQueue(), scheduleOccurrence(), claimDue(), fireDefinition(), poll(), scheduleImmediate() (+3 more)

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat, plugin

### Community 62 - "run-store.ts"
Cohesion: 0.18
Nodes (14): executeTool(), parseMCPToolName(), tool, byName, execute(), getFilteredDefinitions(), IGNORE_DIRS, init() (+6 more)

### Community 65 - "evolutionConfig.ts"
Cohesion: 0.21
Nodes (13): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderContentBlock (+5 more)

### Community 66 - "index.ts"
Cohesion: 0.14
Nodes (12): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+4 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (13): assertInsideDesktop(), cacheDir, desktopDir, devRoot, __dirname, download(), ensureDownloaded(), log() (+5 more)

### Community 69 - "definitions.ts"
Cohesion: 0.19
Nodes (14): ProviderCapability, reconstructParts(), resolveProviderFormat(), textPart, buildInitialMessages(), DEFAULT_PROMPT_FILE(), expandContextReferences(), fixOrphanToolCalls() (+6 more)

### Community 71 - "approval-registry.ts"
Cohesion: 0.17
Nodes (11): 15. 服务端文件改造清单, 16. 前端文件改造清单, 19. 上线与兼容策略, 1. 交付目标, 20. 验收标准, 21. 非目标, 5.1 纯函数, 5.2 固定时机 (+3 more)

### Community 72 - "providerStore.ts"
Cohesion: 0.13
Nodes (17): LLMChunk, LLMOptions, LLMUsage, collect(), lastOf(), main(), run(), withSse() (+9 more)

### Community 73 - "llm-logger.ts"
Cohesion: 0.36
Nodes (6): DesktopAppInfo, formatBytes(), formatSpeed(), UpdatePanel(), DISABLED, useDesktopUpdater()

### Community 74 - "config.ts"
Cohesion: 0.30
Nodes (15): DEFAULT_SYSTEM_RUN_POLICY, normalizeSystemRunPolicy(), SystemRunPolicy, Config, configFilePath(), __dirname, getSystemRunPolicy(), isConfigured() (+7 more)

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

### Community 76 - "server-manager.ts"
Cohesion: 0.27
Nodes (5): ServerManagerOptions, fixtures, DesktopMessage, ServerMessage, serverRoot

### Community 77 - "errors.ts"
Cohesion: 0.21
Nodes (10): cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunResultShape, RunRow, submitRunInput(), AskUserDialog(), ActiveRunState (+2 more)

### Community 78 - "asset-gc.ts"
Cohesion: 0.25
Nodes (8): 17.1 系统配置, 17.2 角色策略与 revision, 17.3 Run 策略解析, 17.4 进展和收敛, 17.5 自动续跑, 17.6 取消和恢复, 17.7 前端, 17. 测试计划

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
Nodes (13): apiGet(), createProvider(), fetchBuiltinProviders(), fetchProviderModels(), fetchProviders(), ProviderModel, ProviderPreset, ProviderPresetField (+5 more)

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

### Community 94 - "streamWithRetry"
Cohesion: 0.46
Nodes (6): updateProvider(), EditProviderDialog(), Props, ProvidersState, useProvidersStore, Provider

### Community 116 - "index.ts"
Cohesion: 0.22
Nodes (12): ALLOWED_MIME, backgroundsDir(), deleteBackgroundImage(), detectMime(), openImageDialog(), registerBackgroundProtocolHandler(), safeBackgroundPath(), saveBackgroundImage() (+4 more)

### Community 119 - "@hono/node-server"
Cohesion: 0.29
Nodes (7): 14.1 客户端状态模型, 14.2 新事件, 14.3 事件归并规则, 14.4 ChatInput, 14.5 状态文案, 14.6 重连, 14. 前端 Run 状态协调

### Community 122 - "jsdom"
Cohesion: 0.29
Nodes (7): 18. 实施阶段, P0：配置和契约, P1：系统和角色 UI, P2：动态收敛, P3：自动续跑服务, P4：前端连续体验, P5：恢复和默认启用

### Community 128 - "run-store.ts"
Cohesion: 0.40
Nodes (5): copyAsset(), dest, __dirname, src, walk()

### Community 129 - "control-router.ts"
Cohesion: 0.21
Nodes (14): CharacterSnapshotContent, CharacterRunPolicy, migrateCharacterRunPolicy(), CharacterRevisionSnapshot, CHAR_DIR(), CharacterMemory, CharacterRecord, ensureCharDir() (+6 more)

### Community 130 - "llm-logger.ts"
Cohesion: 0.15
Nodes (12): markdown-it, markdown-it, MarkdownContent(), md, Props, MessageItem(), Props, showReasoning() (+4 more)

### Community 131 - "index.ts"
Cohesion: 0.24
Nodes (6): ComposeContext, composeMessages(), lastUserIdx(), messages, regular, thinking

### Community 132 - "definitions.ts"
Cohesion: 0.33
Nodes (6): 10.1 共享服务, 10.2 Trigger 语义, 10.3 允许条件, 10.4 链预算, 10.5 创建顺序, 10. 自动续跑

### Community 133 - "checkpoint-store.ts"
Cohesion: 0.33
Nodes (6): 4.1 系统配置文件, 4.2 系统配置校验, 4.3 角色配置, 4.4 角色旧字段迁移, 4.5 Run 策略快照, 4. 配置存储与数据模型

### Community 134 - "7. 初始化与切换流程"
Cohesion: 0.33
Nodes (6): 8.1 模型, 8.2 强进展, 8.3 弱进展, 8.4 不算进展, 8.5 ToolCallRecord 扩展, 8. 进展判定

### Community 135 - "avatarCropStyle"
Cohesion: 0.40
Nodes (5): 11.1 取消, 11.2 用户新输入, 11.3 Parked, 11.4 重启恢复, 11. 取消、并发和崩溃恢复

### Community 136 - "Provider Catalog 图标许可证与来源记录"
Cohesion: 0.40
Nodes (4): Provider Catalog 图标许可证与来源记录, 商标声明, 来源, 许可证

### Community 137 - "4. 进展判定"
Cohesion: 0.70
Nodes (4): ensureDir(), getOutputDir(), truncateError(), truncateToolOutput()

### Community 138 - "6. 主题 Token 设计"
Cohesion: 0.40
Nodes (5): 9.1 运行状态, 9.2 流程, 9.3 Doom-loop, 9.4 结构化结果, 9. Run 内动态收敛

### Community 139 - "5. Run 内动态收敛"
Cohesion: 0.50
Nodes (4): 2.1 哪些配置属于系统, 2.2 哪些配置跟角色走, 2.3 哪些值必须跟 Run 走, 2. 核心决策

### Community 140 - "9. 自动续跑策略"
Cohesion: 0.50
Nodes (4): 3.1 当前系统配置, 3.2 当前角色配置, 3.3 当前 Run, 3. 现状与改造入口

### Community 142 - "10. 取消、并发与 parked 状态"
Cohesion: 0.50
Nodes (4): 6.1 Runs 表, 6.2 历史迁移, 6.3 自动续跑唯一性, 6. 数据库与持久化

### Community 143 - "3. 限额模型"
Cohesion: 0.67
Nodes (3): 12.1 API, 12.2 系统设置 UI, 12. 系统配置 API 与 UI

### Community 144 - "6. 持久化模型"
Cohesion: 0.13
Nodes (20): evaluateSubmission(), SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, handleSubAgentRequest(), handleTaskComplete(), SubAgentOutcome, SubmitResultOutcome (+12 more)

### Community 145 - "edit.integration.test.ts"
Cohesion: 0.33
Nodes (3): ctx, tmp, workspace

### Community 146 - "truncate.ts"
Cohesion: 0.67
Nodes (3): 13.1 API 与工具, 13.2 角色编辑 UI, 13. 角色配置 API 与 UI

### Community 148 - "streamChatCompletion"
Cohesion: 0.57
Nodes (4): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars()

### Community 149 - "revision-store.ts"
Cohesion: 0.22
Nodes (10): CharacterBinding, ResolvedCharacterBinding, CharacterRevisionRow, characterRevisionStore, makeSnapshot(), readVisual(), CHAR_DIR(), characterContentStore (+2 more)

### Community 151 - "types.ts"
Cohesion: 0.67
Nodes (3): fuzzySuggest(), similarity(), tool

### Community 152 - "plan-store.ts"
Cohesion: 0.12
Nodes (24): clamp(), mergeStricterSystemCaps(), resolveRunPolicy(), RunPolicySnapshot, ContinuationEligibility, createResumedRun(), evaluateAutoContinuation(), pinnedCharacterRunPolicy() (+16 more)

### Community 153 - "loop.test.ts"
Cohesion: 0.17
Nodes (7): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, TurnFacts

### Community 157 - "evolutionConfig.ts"
Cohesion: 0.33
Nodes (7): defaults, ensureDataDir(), EvolutionConfig, FILE(), read(), write(), router

### Community 159 - "workspace.ts"
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

## Knowledge Gaps
- **609 isolated node(s):** `name`, `version`, `description`, `author`, `private` (+604 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `startTianshuServer()` connect `CharacterSelector.vue` to `dependencies`, `getDb`, `cronRegistry.ts`, `inner.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `jsdom`, `useProvidersStore`, `package.json`, `@hono/node-server`, `htmlparser2`, `iconv-lite`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `hono` connect `dependencies` to `CharacterSelector.vue`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _609 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `SkillSettings.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.13043478260869565 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.07474747474747474 - nodes in this community are weakly interconnected._