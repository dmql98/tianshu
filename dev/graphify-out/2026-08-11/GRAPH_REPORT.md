# Graph Report - dev  (2026-08-11)

## Corpus Check
- 279 files · ~224,707 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1596 nodes · 3376 edges · 132 communities (94 shown, 38 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39c9a85b`
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
- workspace.ts
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
- @hono/node-server
- htmlparser2
- iconv-lite
- jsdom
- run-store.ts
- control-router.ts
- sub-agent.ts
- toolStore.ts
- definitions.ts
- index.ts
- avatarCropStyle

## God Nodes (most connected - your core abstractions)
1. `getDataDir()` - 52 edges
2. `apiGet()` - 39 edges
3. `apiPost()` - 39 edges
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

## Communities (132 total, 38 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): better-sqlite3, hono, @modelcontextprotocol/sdk, @mozilla/readability, socket.io, turndown, dependencies, better-sqlite3 (+7 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.16
Nodes (15): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, assetDir(), assetIndexPath(), CharacterAssetKind, CharacterAssetRef (+7 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.08
Nodes (24): 08：桌面角色窗口已取消, 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）, 1. 任务背景, 2.1 Run、RunEvent 与持久事件骨架, 2.2 CharacterDefinition / CharacterRevision, 2.3 消息 revision 与会话分支, 2.4 08 第一阶段：资源、Renderer 与 Presence, 2.5 角色资源引用保护与包 (+16 more)

### Community 4 - "dependencies"
Cohesion: 0.19
Nodes (13): createSkillPackage(), fetchSkillChild(), fetchSkillPackage(), fetchSkillPackages(), SkillChildDetail, SkillFile, SkillPackageChild, SkillPackageDetail (+5 more)

### Community 5 - "chat.ts"
Cohesion: 0.16
Nodes (11): browseDirectory(), BrowseResult, DirEntry, openInFileManager(), resolvePath(), Props, ContextMenu, ProjectContextMenu (+3 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.08
Nodes (24): author, dependencies, electron-updater, description, devDependencies, electron, electron-builder, @types/node (+16 more)

### Community 7 - "index.ts"
Cohesion: 0.11
Nodes (19): children, CLIENT_PORT, clientDir, desktopDir, devRoot, __dirname, electron, electronPath (+11 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.14
Nodes (14): mcpServerStore, router, TOOLS_DIR, classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), disconnectMCPServer(), MCPServerConfig (+6 more)

### Community 9 - "outer.ts"
Cohesion: 0.11
Nodes (26): cachePath(), cacheStats(), capturePrefixShape(), compareShapes(), diagnoseMiss(), extractComponents(), FingerprintComponents, flatContent() (+18 more)

### Community 10 - "package.json"
Cohesion: 0.18
Nodes (11): react, react-dom, react-router-dom, socket.io-client, dependencies, react, react-dom, react-router-dom (+3 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.12
Nodes (20): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+12 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.10
Nodes (21): cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunRow, submitRunInput(), AskUserDialog(), applyRunEvents(), Attachment (+13 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.15
Nodes (24): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterMotionBinding, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacterVisual() (+16 more)

### Community 14 - "inner.ts"
Cohesion: 0.14
Nodes (20): approveToolForSession(), getSessionState(), isToolApprovedForSession(), removeSessionState(), abortSession(), enqueueRun(), getQueueLength(), getRunState() (+12 more)

### Community 15 - "apiGet"
Cohesion: 0.14
Nodes (24): deleteCharacter(), apiDelete(), apiGet(), apiPost(), createProvider(), deleteProvider(), fetchBuiltinProviders(), fetchCustomProviders() (+16 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.29
Nodes (6): capMessage(), clampPercent(), toMessage(), UpdateManager, UpdateManagerOptions, UpdateState

### Community 17 - "tools.ts"
Cohesion: 0.18
Nodes (7): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions

### Community 18 - "compilerOptions"
Cohesion: 0.08
Nodes (23): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+15 more)

### Community 19 - "useChatStore"
Cohesion: 0.19
Nodes (14): createCharacter(), fetchCharacter(), fetchCharacterStats(), updateCharacter(), updateCharacterSkillBinding(), EditFieldProps, dedupeToolBindings(), getUnboundTools() (+6 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.19
Nodes (16): updateProvider(), ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), RightPanel() (+8 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.06
Nodes (51): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderContentBlock (+43 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.22
Nodes (6): markdown-it, markdown-it, MarkdownContent(), md, Props, Props

### Community 23 - "eventExecutor.ts"
Cohesion: 0.15
Nodes (18): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+10 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (18): archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences() (+10 more)

### Community 25 - "apiGet"
Cohesion: 0.15
Nodes (17): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), evaluateSubmission(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, handleTaskComplete() (+9 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.49
Nodes (9): buildCompactionSummary(), compactHistory(), extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary(), contentToText() (+1 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.13
Nodes (30): apiPut(), reloadDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+22 more)

### Community 28 - "goals.ts"
Cohesion: 0.21
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.27
Nodes (7): fetchCharacterPresence(), connectSocket(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 30 - "context-builder.ts"
Cohesion: 0.08
Nodes (23): 10.1 单元测试, 10.2 构建验证, 10.3 手工验收矩阵, 10. 测试计划, 11. 验收标准, 12. 推荐实施顺序, 13. 实施约束, 1. 开发目标 (+15 more)

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.21
Nodes (13): CharacterSnapshotContent, CharacterRevisionSnapshot, CHAR_DIR(), CharacterMemory, CharacterRecord, ensureCharDir(), normalizeRecord(), pathFor() (+5 more)

### Community 33 - "checkpoint-store.ts"
Cohesion: 0.47
Nodes (4): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore

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
Nodes (12): CharacterBinding, resolveCharacterBinding(), ResolvedCharacterBinding, CharacterRevisionRow, characterRevisionStore, makeSnapshot(), readVisual(), CHAR_DIR() (+4 more)

### Community 38 - "validate.ts"
Cohesion: 0.10
Nodes (9): tool, tool, coerceBoolean, coerceNumber, validate(), ValidationError, tool, turndown (+1 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.14
Nodes (17): DEV_CORS_ORIGINS, isLoopbackOrigin(), MIME, serveClientHandler(), StartServerOptions, startTianshuServer(), TianshuServer, stopAssetGC() (+9 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.13
Nodes (23): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), InnerResult, matchToolCall(), READ_ONLY_TOOLS (+15 more)

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
Cohesion: 0.10
Nodes (38): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+30 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.13
Nodes (15): tsx, @types/better-sqlite3, @types/glob, @types/jsdom, @types/turndown, devDependencies, tsx, @types/better-sqlite3 (+7 more)

### Community 48 - "context-references.ts"
Cohesion: 0.15
Nodes (13): @types/react, @types/react-dom, vite, @vitejs/plugin-react, devDependencies, @types/react, @types/react-dom, typescript (+5 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 50 - "goals.ts"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, preview, test, type (+1 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.21
Nodes (14): scanCommandPaths(), tool, exactMatch(), findBestMatch(), assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin() (+6 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.13
Nodes (19): getDataDir(), DEBUG_DIR(), logLLMCall(), systemPromptFingerprint(), DEBUG_DIR(), deleteOldDebugSessions(), mergeOldDebugTurns(), defaults (+11 more)

### Community 56 - "GeneralEventSettings.vue"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 57 - "sessions.ts"
Cohesion: 0.33
Nodes (3): db, NOW, tmpData

### Community 58 - "compose.ts"
Cohesion: 0.28
Nodes (5): composeMessages(), lastUserIdx(), messages, regular, thinking

### Community 59 - "App.tsx"
Cohesion: 0.21
Nodes (15): server, sessionLoop(), runEventStore, messageStore, SessionRow, sessionStore, TurnRow, turnStore (+7 more)

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 62 - "run-store.ts"
Cohesion: 0.17
Nodes (14): executeTool(), parseMCPToolName(), tool, byName, execute(), getFilteredDefinitions(), IGNORE_DIRS, init() (+6 more)

### Community 65 - "toolStore.ts"
Cohesion: 0.33
Nodes (6): MessageItem(), Props, showReasoning(), icons, Props, Message

### Community 66 - "index.ts"
Cohesion: 0.14
Nodes (12): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+4 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (13): assertInsideDesktop(), cacheDir, desktopDir, devRoot, __dirname, download(), ensureDownloaded(), log() (+5 more)

### Community 69 - "definitions.ts"
Cohesion: 0.67
Nodes (3): fuzzySuggest(), similarity(), tool

### Community 71 - "approval-registry.ts"
Cohesion: 0.14
Nodes (17): fetchCharacters(), updateSession(), CharacterPicker(), Props, CharactersPage(), previewMotions, roleLabels, timeAgo() (+9 more)

### Community 72 - "providerStore.ts"
Cohesion: 0.15
Nodes (16): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars(), DATA_DIR(), ensureDataDir(), ensureIds(), FILE() (+8 more)

### Community 73 - "llm-logger.ts"
Cohesion: 0.31
Nodes (7): DesktopAppInfo, UpdatePhase, formatBytes(), formatSpeed(), UpdatePanel(), DISABLED, useDesktopUpdater()

### Community 74 - "config.ts"
Cohesion: 0.33
Nodes (9): Config, configFilePath(), __dirname, isConfigured(), legacyHasData(), loadConfig(), setDataDir(), writeConfig() (+1 more)

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

### Community 76 - "server-manager.ts"
Cohesion: 0.27
Nodes (5): ServerManagerOptions, fixtures, DesktopMessage, ServerMessage, serverRoot

### Community 78 - "asset-gc.ts"
Cohesion: 0.27
Nodes (12): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), characterVisualStore, getDb() (+4 more)

### Community 79 - "smoke-packaged.mjs"
Cohesion: 0.25
Nodes (6): child, dataDir, [nodeExe, stagingServer, clientDist], sqlite, timeout, ver

### Community 81 - "index.ts"
Cohesion: 0.50
Nodes (3): hasBOM(), stripBOM(), tool

### Community 82 - "copy-tool-json.js"
Cohesion: 0.50
Nodes (3): dest, __dirname, src

### Community 83 - "main.ts"
Cohesion: 0.33
Nodes (3): logUpdater(), registerIpc(), updaterLogFile()

### Community 84 - "package.json"
Cohesion: 0.29
Nodes (6): engines, node, name, private, type, version

### Community 88 - "workspace.ts"
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

### Community 90 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, start, test

### Community 91 - "verify-release-version.mjs"
Cohesion: 0.50
Nodes (3): desktopPkg, devRoot, __dirname

### Community 128 - "run-store.ts"
Cohesion: 0.15
Nodes (13): ProviderCapability, ComposeContext, CONTROL_TOOL_NAMES, ControlToolDefinition, getControlToolDefinitions(), LoopEngineContext, RunResult, GoalRow (+5 more)

### Community 129 - "control-router.ts"
Cohesion: 0.21
Nodes (14): SubmissionCheckResult, CompactResult, AskUserOutcome, CreatePlanOutcome, handleAskUser(), handleCreatePlan(), handleSubAgentRequest(), handleUpdatePlanStep() (+6 more)

### Community 130 - "sub-agent.ts"
Cohesion: 0.15
Nodes (18): createDurableSocket(), PHASE_BY_EVENT, publishRunEvent(), RAW_SOCKET, RunEventRow, terminalStatus(), unwrapDurableSocket(), ALLOWED_TRANSITIONS (+10 more)

### Community 131 - "toolStore.ts"
Cohesion: 0.32
Nodes (11): configPath(), ensureMcpDir(), findById(), findDirById(), MCP_DIR(), MCPServerRecord, migrateFromOldFile(), OLD_FILE() (+3 more)

### Community 132 - "definitions.ts"
Cohesion: 0.29
Nodes (9): getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints(), getAll(), ToolConstraint (+1 more)

### Community 134 - "index.ts"
Cohesion: 0.33
Nodes (7): tool, parseSkillNames(), parsed, toolBindings, updated, updateNamedBindings(), updateSkillNames()

### Community 135 - "avatarCropStyle"
Cohesion: 0.47
Nodes (7): AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog(), clamp(), Props

## Knowledge Gaps
- **446 isolated node(s):** `name`, `version`, `description`, `author`, `private` (+441 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `stableJson()` connect `registry.ts` to `cronRegistry.ts`?**
  _High betweenness centrality (0.320) - this node is a cross-community bridge._
- **Why does `FilePanel()` connect `system-cache.ts` to `registry.ts`?**
  _High betweenness centrality (0.218) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _446 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `toolStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._