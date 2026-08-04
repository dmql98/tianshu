# Graph Report - dev  (2026-08-03)

## Corpus Check
- 231 files · ~172,455 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1211 nodes · 2616 edges · 97 communities (69 shown, 28 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d020a858`
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
- control-router.ts
- SettingsPage.tsx
- goals.ts
- index.ts
- context-builder.ts
- tools.ts
- ChatInput.tsx
- MessageItem.tsx
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
- toolStore.ts
- skill-loader.ts
- context-compactor.ts
- context-references.ts
- providerStore.ts
- types.ts
- utils.ts
- registry.ts
- compilerOptions
- MarkdownRenderer.vue
- GeneralEventSettings.vue
- sessions.ts
- App.tsx
- ProviderPlugin
- index.ts
- skills.ts
- workspace.ts
- DisplaySettings.vue
- checkpoint-store.ts
- index.ts
- 弈 (Yì) — AI Agent 系统
- AvatarCropDialog.tsx
- markdown-it.d.ts
- index.ts
- copy-tool-json.js
- electron.d.ts
- AGENTS.md
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

## God Nodes (most connected - your core abstractions)
1. `apiGet()` - 38 edges
2. `ProviderPlugin` - 36 edges
3. `sessionLoop()` - 33 edges
4. `apiPost()` - 32 edges
5. `getDb()` - 29 edges
6. `getDataDir()` - 24 edges
7. `runLoopEngine()` - 19 edges
8. `LLMMessage` - 19 edges
9. `fetchCharacters()` - 18 edges
10. `apiPut()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `fetchDataspace()`  [EXTRACTED]
  web/client/src/App.tsx → web/client/src/api/config.ts
- `CharacterPicker()` --calls--> `fetchCharacters()`  [EXTRACTED]
  web/client/src/components/Chat/CharacterPicker.tsx → web/client/src/api/characters.ts
- `fetchCustomProviders()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/providers.ts → web/client/src/api/client.ts
- `fetchProviderModels()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/providers.ts → web/client/src/api/client.ts
- `fetchProviders()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/providers.ts → web/client/src/api/client.ts

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (97 total, 28 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (46): better-sqlite3, glob, hono, @hono/node-server, htmlparser2, iconv-lite, jsdom, @modelcontextprotocol/sdk (+38 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.18
Nodes (10): detectDoomLoop(), evaluateFinalAnswer(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, runLoopEngine(), estimateTokens(), shouldCompact() (+2 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.08
Nodes (24): 08：桌面角色窗口已取消, 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）, 1. 任务背景, 2.1 Run、RunEvent 与持久事件骨架, 2.2 CharacterDefinition / CharacterRevision, 2.3 消息 revision 与会话分支, 2.4 08 第一阶段：资源、Renderer 与 Presence, 2.5 角色资源引用保护与包 (+16 more)

### Community 4 - "dependencies"
Cohesion: 0.19
Nodes (12): fetchCharacters(), fetchSkillDetail(), fetchSkillFile(), fetchSkills(), FileContent, SkillDetail, SkillFile, SkillMeta (+4 more)

### Community 5 - "chat.ts"
Cohesion: 0.16
Nodes (11): browseDirectory(), BrowseResult, DirEntry, openInFileManager(), resolvePath(), Props, ContextMenu, ProjectContextMenu (+3 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.20
Nodes (17): resolveCharacterBinding(), EventDefinitionRow, eventDefinitionStore, broadcastSocket(), drainQueue(), executeOccurrence(), fireOnceEvent(), scheduleOccurrence() (+9 more)

### Community 7 - "index.ts"
Cohesion: 0.15
Nodes (16): createCharacter(), fetchCharacter(), fetchCharacterStats(), updateCharacter(), getSocket(), CharacterDetailPage(), roleLabels, CharacterStats (+8 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.15
Nodes (16): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, assetDir(), assetIndexPath(), CharacterAssetKind, CharacterAssetRef (+8 more)

### Community 9 - "outer.ts"
Cohesion: 0.11
Nodes (30): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+22 more)

### Community 10 - "package.json"
Cohesion: 0.06
Nodes (30): react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+22 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.11
Nodes (21): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+13 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.15
Nodes (13): applyRunEvents(), Attachment, ChatState, initPersistentListeners(), loadPersistedDefaults(), PendingApproval, runSeqByRunId, savePersistedDefaults() (+5 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.18
Nodes (23): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacterVisual(), importCharacterPackage() (+15 more)

### Community 14 - "inner.ts"
Cohesion: 0.06
Nodes (55): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS, retries (+47 more)

### Community 15 - "apiGet"
Cohesion: 0.18
Nodes (14): createProvider(), fetchBuiltinProviders(), fetchCustomProviders(), fetchProviderModels(), fetchProviders(), ProviderModel, updateProvider(), AddProviderDialog() (+6 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.24
Nodes (8): updateSession(), CharacterPicker(), Props, CharactersPage(), previewMotions, roleLabels, timeAgo(), Character

### Community 17 - "tools.ts"
Cohesion: 0.11
Nodes (11): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions, runStore (+3 more)

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.24
Nodes (8): ComposeContext, composeMessages(), lastUserIdx(), stripReasoning(), LLMChunk, LLMOptions, LLMUsage, ToolCall

### Community 20 - "system-cache.ts"
Cohesion: 0.19
Nodes (14): ApprovalDialog(), ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), isCompact() (+6 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.27
Nodes (10): mergeContent(), getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints() (+2 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.12
Nodes (27): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderCapability (+19 more)

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (19): apiPost(), archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions() (+11 more)

### Community 25 - "apiGet"
Cohesion: 0.38
Nodes (11): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+3 more)

### Community 26 - "control-router.ts"
Cohesion: 0.22
Nodes (13): createDurableSocket(), PHASE_BY_EVENT, publishRunEvent(), RAW_SOCKET, RunEventRow, runEventStore, terminalStatus(), unwrapDurableSocket() (+5 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.25
Nodes (15): apiPut(), fetchDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+7 more)

### Community 28 - "goals.ts"
Cohesion: 0.29
Nodes (12): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+4 more)

### Community 29 - "index.ts"
Cohesion: 0.15
Nodes (14): messageStore, DATA_DIR, TurnRow, turnStore, app, httpServer, io, router (+6 more)

### Community 30 - "context-builder.ts"
Cohesion: 0.18
Nodes (11): CharacterBinding, ResolvedCharacterBinding, CharacterRevisionRow, characterRevisionStore, makeSnapshot(), readVisual(), CHAR_DIR, characterContentStore (+3 more)

### Community 31 - "tools.ts"
Cohesion: 0.17
Nodes (14): createMCPServer(), deleteMCPServer(), fetchTools(), MCPConnectionStatus, MCPServer, MCPTestResult, testMCPConnection(), ToolMeta (+6 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.44
Nodes (7): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), getDb()

### Community 33 - "MessageItem.tsx"
Cohesion: 0.23
Nodes (7): MessageItem(), Props, showReasoning(), Props, icons, Props, Message

### Community 34 - "Sidebar.vue"
Cohesion: 0.13
Nodes (19): deleteCharacter(), apiDelete(), apiGet(), deleteProvider(), cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunRow (+11 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.09
Nodes (20): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, mcpServerStore, migrateFromOldFile(), OLD_FILE, readByName() (+12 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.25
Nodes (6): DATA_DIR, DEBUG_DIR, mergeOldDebugTurns(), DATA_DIR, DEBUG_DIR, tool

### Community 38 - "validate.ts"
Cohesion: 0.14
Nodes (7): tool, tool, coerceBoolean, coerceNumber, validate(), ValidationError, tool

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.25
Nodes (5): DATA_DIR, defaults, EvolutionConfig, FILE, router

### Community 40 - "InputToolbar.vue"
Cohesion: 0.25
Nodes (6): ALLOWED_TRANSITIONS, RunPhase, RunRow, RunStatus, TERMINAL, SessionRow

### Community 41 - "MessageItem.vue"
Cohesion: 0.20
Nodes (3): App(), navItems, KnowledgePage()

### Community 42 - "sub-agent.ts"
Cohesion: 0.13
Nodes (26): InnerResult, ToolCallRecord, evaluateSubmission(), SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, handleAskUser(), handleCreatePlan() (+18 more)

### Community 43 - "matchers.ts"
Cohesion: 0.29
Nodes (11): collapseWhitespace(), contextAwareMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers, MatchResult, normalizeLineEndings() (+3 more)

### Community 45 - "toolStore.ts"
Cohesion: 0.21
Nodes (11): Config, CONFIG_FILE, __dirname, getDataDir(), isConfigured(), loadConfig(), setDataDir(), router (+3 more)

### Community 46 - "skill-loader.ts"
Cohesion: 0.24
Nodes (12): buildSkillIndex(), DATA_DIR, extractTianshuArray(), findSkillByName(), findSkillDir(), listFiles(), parseFrontmatter(), skillDirFor() (+4 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.47
Nodes (4): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore

### Community 48 - "context-references.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.19
Nodes (10): DATA_DIR, ensureIds(), FILE, ModelInfo, ProviderRecord, providerStore, readAll(), writeAll() (+2 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.19
Nodes (13): scanCommandPaths(), tool, exactMatch(), findBestMatch(), fuzzySuggest(), similarity(), tool, assertPathSafe() (+5 more)

### Community 53 - "registry.ts"
Cohesion: 0.17
Nodes (14): executeTool(), parseMCPToolName(), tool, byName, execute(), getFilteredDefinitions(), IGNORE_DIRS, init() (+6 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.27
Nodes (7): fetchCharacterPresence(), connectSocket(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 56 - "GeneralEventSettings.vue"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 57 - "sessions.ts"
Cohesion: 0.33
Nodes (3): db, NOW, tmpData

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 62 - "skills.ts"
Cohesion: 0.24
Nodes (9): DATA_DIR, findSkills(), parseFrontmatter(), parseList(), router, SkillDetail, SkillFile, SkillMeta (+1 more)

### Community 63 - "workspace.ts"
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

### Community 65 - "checkpoint-store.ts"
Cohesion: 0.16
Nodes (11): CharacterSnapshotContent, CharacterRevisionSnapshot, CHAR_DIR, CharacterMemory, CharacterRecord, DATA_DIR, normalizeRecord(), pathFor() (+3 more)

### Community 66 - "index.ts"
Cohesion: 0.20
Nodes (4): LOG_DIR, ShellInfo, TEMP_DIR, tool

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 70 - "AvatarCropDialog.tsx"
Cohesion: 0.47
Nodes (7): AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog(), clamp(), Props

### Community 78 - "markdown-it.d.ts"
Cohesion: 0.29
Nodes (4): markdown-it, MarkdownIt, MarkdownItConstructor, MarkdownItOptions

### Community 81 - "index.ts"
Cohesion: 0.50
Nodes (3): hasBOM(), stripBOM(), tool

### Community 82 - "copy-tool-json.js"
Cohesion: 0.50
Nodes (3): dest, __dirname, src

## Knowledge Gaps
- **340 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+335 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDataDir()` connect `toolStore.ts` to `checkpoint-store.ts`, `attachments.ts`, `cronRegistry.ts`, `CharacterSelector.vue`, `RoleSettings.vue`, `outer.ts`, `offlineMiner.ts`, `skill-loader.ts`, `inner.ts`, `providerStore.ts`, `loop.test.ts`, `skills.ts`, `index.ts`, `context-builder.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `expandContextReferences()` connect `loop.test.ts` to `context-references.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `getDb()` connect `ChatInput.tsx` to `toolStore.ts`, `InputToolbar.vue`, `RoleSettings.vue`, `sub-agent.ts`, `offlineMiner.ts`, `inner.ts`, `context-compactor.ts`, `control-router.ts`, `index.ts`, `context-builder.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _340 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `outer.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._