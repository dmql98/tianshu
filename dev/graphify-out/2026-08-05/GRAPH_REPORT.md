# Graph Report - dev  (2026-08-05)

## Corpus Check
- 248 files · ~180,758 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1320 nodes · 2863 edges · 99 communities (71 shown, 28 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `014dc380`
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
- index.ts
- 弈 (Yì) — AI Agent 系统
- AvatarCropDialog.tsx
- normalize-skill-frontmatter.mjs
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
1. `apiGet()` - 39 edges
2. `apiPost()` - 37 edges
3. `ProviderPlugin` - 36 edges
4. `sessionLoop()` - 33 edges
5. `getDb()` - 30 edges
6. `getDataDir()` - 23 edges
7. `runLoopEngine()` - 20 edges
8. `LLMMessage` - 20 edges
9. `fetchCharacters()` - 18 edges
10. `apiPut()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `fetchChildSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `renameSession()` --calls--> `apiPut()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `CompactResult` --references--> `LLMMessage`  [EXTRACTED]
  web/server/src/agent/loop/context-compactor.ts → web/server/src/llm/client.ts
- `spawnAndRunSubAgent()` --indirect_call--> `terminalStatus()`  [INFERRED]
  web/server/src/agent/sub-agent.ts → web/server/src/agent/runtime/run-event-store.ts
- `scanCommandPaths()` --calls--> `assertPathSafe()`  [EXTRACTED]
  web/server/src/tools/bash/index.ts → web/server/src/tools/utils.ts

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (99 total, 28 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (46): better-sqlite3, glob, hono, @hono/node-server, htmlparser2, iconv-lite, jsdom, @modelcontextprotocol/sdk (+38 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.32
Nodes (8): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), DATA_DIR, getDb()

### Community 3 - "EventsView.vue"
Cohesion: 0.08
Nodes (24): 08：桌面角色窗口已取消, 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）, 1. 任务背景, 2.1 Run、RunEvent 与持久事件骨架, 2.2 CharacterDefinition / CharacterRevision, 2.3 消息 revision 与会话分支, 2.4 08 第一阶段：资源、Renderer 与 Presence, 2.5 角色资源引用保护与包 (+16 more)

### Community 4 - "dependencies"
Cohesion: 0.24
Nodes (10): createSkillPackage(), fetchSkillChild(), fetchSkillPackage(), SkillChildDetail, SkillFile, SkillPackageChild, SkillPackageDetail, SkillPackageMeta (+2 more)

### Community 5 - "chat.ts"
Cohesion: 0.17
Nodes (12): apiGet(), fetchCustomProviders(), fetchProviderModels(), fetchProviders(), fetchSessionMessages(), fetchSessions(), browseDirectory(), BrowseResult (+4 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.26
Nodes (10): EventDefinitionRow, eventDefinitionStore, claimDue(), fireDefinition(), poll(), scheduleImmediate(), startEventScheduler(), EventOccurrenceRow (+2 more)

### Community 7 - "index.ts"
Cohesion: 0.13
Nodes (15): ContextMenu, ProjectContextMenu, SessionPanel(), ChatState, CharacterStats, Event, ProviderModel, Session (+7 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.15
Nodes (16): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, assetDir(), assetIndexPath(), CharacterAssetKind, CharacterAssetRef (+8 more)

### Community 9 - "outer.ts"
Cohesion: 0.10
Nodes (33): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+25 more)

### Community 10 - "package.json"
Cohesion: 0.06
Nodes (30): react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+22 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.11
Nodes (21): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+13 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.12
Nodes (19): cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunRow, submitRunInput(), AskUserDialog(), applyRunEvents(), Attachment (+11 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.15
Nodes (27): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacterVisual(), importCharacterPackage() (+19 more)

### Community 14 - "inner.ts"
Cohesion: 0.23
Nodes (15): getSessionState(), removeSessionState(), abortSession(), SessionState, setSessionStrategy(), states, isStrategyInput(), LEGACY_STRATEGY_MAP (+7 more)

### Community 15 - "apiGet"
Cohesion: 0.27
Nodes (12): createProvider(), fetchBuiltinProviders(), ProviderModel, updateProvider(), AddProviderDialog(), formatLabel, Props, EditProviderDialog() (+4 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.16
Nodes (16): createCharacter(), fetchCharacter(), fetchCharacters(), fetchCharacterStats(), updateCharacter(), updateCharacterSkillBinding(), updateSession(), fetchSkillPackages() (+8 more)

### Community 17 - "tools.ts"
Cohesion: 0.18
Nodes (6): CancelScope, completeRun(), executeRun(), QueuedRun, SessionEntry, sessions

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.08
Nodes (34): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS, retries (+26 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.18
Nodes (12): ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), isCompact(), MessageList() (+4 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.21
Nodes (9): executeTool(), parseMCPToolName(), byName, execute(), getFilteredDefinitions(), IGNORE_DIRS, init(), readToolJson() (+1 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.23
Nodes (7): MessageItem(), Props, showReasoning(), Props, icons, Props, Message

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (18): archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences() (+10 more)

### Community 25 - "apiGet"
Cohesion: 0.12
Nodes (22): ComposeContext, InnerResult, SubAgentRequestData, SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, SubAgentOutcome, SubmitResultOutcome (+14 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.42
Nodes (10): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+2 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.26
Nodes (14): apiPut(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt(), saveDefaultPrompt() (+6 more)

### Community 28 - "goals.ts"
Cohesion: 0.21
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.27
Nodes (7): fetchCharacterPresence(), connectSocket(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 30 - "context-builder.ts"
Cohesion: 0.24
Nodes (8): tool, tool, tool, ConstraintField, ToolConstraint, ToolContext, ToolModule, ToolResult

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.22
Nodes (7): CHAR_DIR, CharacterMemory, DATA_DIR, normalizeRecord(), pathFor(), readAll(), SkillBinding

### Community 34 - "Sidebar.vue"
Cohesion: 0.23
Nodes (12): deleteCharacter(), apiDelete(), apiPost(), deleteProvider(), createSession(), deleteSession(), fetchChildSessions(), forkSession() (+4 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.06
Nodes (45): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, mcpServerStore, migrateFromOldFile(), OLD_FILE, readByName() (+37 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.14
Nodes (13): Config, CONFIG_FILE, __dirname, isConfigured(), loadConfig(), setDataDir(), DATA_DIR, DEBUG_DIR (+5 more)

### Community 38 - "validate.ts"
Cohesion: 0.12
Nodes (10): tool, tool, fuzzySuggest(), similarity(), tool, coerceBoolean, coerceNumber, validate() (+2 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.09
Nodes (18): setEventDefinitionRuntime(), DATA_DIR, defaults, EvolutionConfig, FILE, app, httpServer, io (+10 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.12
Nodes (26): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderCapability (+18 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.20
Nodes (4): fetchDataspace(), App(), navItems, KnowledgePage()

### Community 42 - "sub-agent.ts"
Cohesion: 0.13
Nodes (22): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), evaluateSubmission(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, handleAskUser() (+14 more)

### Community 43 - "matchers.ts"
Cohesion: 0.26
Nodes (12): collapseWhitespace(), contextAwareMatch(), findBestMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers, MatchResult (+4 more)

### Community 45 - "client.ts"
Cohesion: 0.36
Nodes (9): mergeContent(), getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints() (+1 more)

### Community 46 - "skill-loader.ts"
Cohesion: 0.09
Nodes (39): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+31 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.19
Nodes (10): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore, PHASE_BY_EVENT, RAW_SOCKET, RunEventRow, runEventStore (+2 more)

### Community 48 - "context-references.ts"
Cohesion: 0.14
Nodes (16): CharacterSnapshotContent, CharacterBinding, resolveCharacterBinding(), ResolvedCharacterBinding, CharacterRevisionRow, CharacterRevisionSnapshot, characterRevisionStore, makeSnapshot() (+8 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.15
Nodes (15): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars(), DATA_DIR, ensureIds(), FILE, ModelInfo (+7 more)

### Community 50 - "goals.ts"
Cohesion: 0.14
Nodes (22): createDurableSocket(), publishRunEvent(), terminalStatus(), unwrapDurableSocket(), runStore, enqueueRun(), spawnAndRunSubAgent(), SubResult (+14 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.25
Nodes (12): tool, exactMatch(), assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin(), normalizePathForPlatform(), realRoot() (+4 more)

### Community 53 - "registry.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.29
Nodes (6): AttachmentMeta, DATA_DIR, extFor(), loadAttachmentBase64(), MEDIA_DIR, saveAttachment()

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
Cohesion: 0.33
Nodes (7): tool, parseSkillNames(), parsed, toolBindings, updated, updateNamedBindings(), updateSkillNames()

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 62 - "run-store.ts"
Cohesion: 0.25
Nodes (6): ALLOWED_TRANSITIONS, RunPhase, RunRow, RunStatus, TERMINAL, SessionRow

### Community 63 - "session-runner.ts"
Cohesion: 0.29
Nodes (4): runCoordinator, getQueueLength(), getRunState(), RunState

### Community 66 - "index.ts"
Cohesion: 0.13
Nodes (13): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+5 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 70 - "AvatarCropDialog.tsx"
Cohesion: 0.47
Nodes (7): AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog(), clamp(), Props

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

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
- **369 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+364 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `expandContextReferences()` connect `InputToolbar.vue` to `registry.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `getDataDir()` connect `context-references.ts` to `ChatInput.tsx`, `SkillSettings.vue`, `attachments.ts`, `cronRegistry.ts`, `CharacterSelector.vue`, `InputToolbar.vue`, `outer.ts`, `RoleSettings.vue`, `offlineMiner.ts`, `skill-loader.ts`, `providerStore.ts`, `useChatStore`, `MarkdownRenderer.vue`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `ToolModule` connect `context-builder.ts` to `MessageItem.tsx`, `index.ts`, `attachments.ts`, `cronRegistry.ts`, `validate.ts`, `skill-loader.ts`, `index.ts`, `utils.ts`, `characterStore.ts`, `App.tsx`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _369 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1286549707602339 - nodes in this community are weakly interconnected._