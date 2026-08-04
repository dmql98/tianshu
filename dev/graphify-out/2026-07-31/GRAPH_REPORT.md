# Graph Report - dev  (2026-07-31)

## Corpus Check
- 228 files · ~169,095 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1185 nodes · 2537 edges · 100 communities (72 shown, 28 thin omitted)
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
- errors.ts
- types.ts
- utils.ts
- registry.ts
- compilerOptions
- MarkdownRenderer.vue
- GeneralEventSettings.vue
- sessions.ts
- skills.ts
- App.tsx
- ProviderPlugin
- index.ts
- skills.ts
- types.ts
- DisplaySettings.vue
- index.ts
- index.ts
- 弈 (Yì) — AI Agent 系统
- sessionStore.ts
- workspace.ts
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
3. `sessionLoop()` - 32 edges
4. `getDb()` - 29 edges
5. `apiPost()` - 26 edges
6. `getDataDir()` - 24 edges
7. `runLoopEngine()` - 19 edges
8. `LLMMessage` - 19 edges
9. `fetchCharacters()` - 18 edges
10. `apiPut()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `spawnAndRunSubAgent()` --indirect_call--> `terminalStatus()`  [INFERRED]
  web/server/src/agent/sub-agent.ts → web/server/src/agent/runtime/run-event-store.ts
- `App()` --calls--> `fetchDataspace()`  [EXTRACTED]
  web/client/src/App.tsx → web/client/src/api/config.ts
- `fetchSkillFile()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/skills.ts → web/client/src/api/client.ts
- `renameSession()` --calls--> `apiPut()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `fetchCharacters()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/characters.ts → web/client/src/api/client.ts

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (100 total, 28 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (46): better-sqlite3, glob, hono, @hono/node-server, htmlparser2, iconv-lite, jsdom, @modelcontextprotocol/sdk (+38 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.15
Nodes (16): fetchCharacters(), updateSession(), fetchSkillDetail(), fetchSkillFile(), fetchSkills(), FileContent, SkillDetail, SkillFile (+8 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.08
Nodes (24): 08：桌面角色窗口已取消, 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）, 1. 任务背景, 2.1 Run、RunEvent 与持久事件骨架, 2.2 CharacterDefinition / CharacterRevision, 2.3 消息 revision 与会话分支, 2.4 08 第一阶段：资源、Renderer 与 Presence, 2.5 角色资源引用保护与包 (+16 more)

### Community 4 - "dependencies"
Cohesion: 0.13
Nodes (17): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore, PHASE_BY_EVENT, RAW_SOCKET, RunEventRow, runEventStore (+9 more)

### Community 5 - "chat.ts"
Cohesion: 0.25
Nodes (10): createDurableSocket(), publishRunEvent(), unwrapDurableSocket(), enqueueRun(), spawnAndRunSubAgent(), SubResult, SubSummary, validateSubAgentTarget() (+2 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.15
Nodes (13): mcpServerStore, router, TOOLS_DIR, classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), MCPServerConfig, MCPToolDef (+5 more)

### Community 7 - "index.ts"
Cohesion: 0.14
Nodes (15): createCharacter(), ContextMenu, SessionPanel(), roleLabels, ChatState, CharacterStats, Event, ProviderModel (+7 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.14
Nodes (17): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, assetDir(), assetIndexPath(), CharacterAssetKind, CharacterAssetRef (+9 more)

### Community 9 - "outer.ts"
Cohesion: 0.11
Nodes (28): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+20 more)

### Community 10 - "package.json"
Cohesion: 0.06
Nodes (30): react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+22 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.11
Nodes (21): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+13 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.13
Nodes (16): fetchRecentRuns(), fetchRunEvents(), RunRow, applyRunEvents(), Attachment, initPersistentListeners(), loadPersistedDefaults(), PendingApproval (+8 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.17
Nodes (24): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacter(), fetchCharacterStats() (+16 more)

### Community 14 - "inner.ts"
Cohesion: 0.20
Nodes (16): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS, retries (+8 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.25
Nodes (12): broadcastSocket(), drainQueue(), executeOccurrence(), fireOnceEvent(), scheduleOccurrence(), setEventDefinitionRuntime(), claimDue(), fireDefinition() (+4 more)

### Community 17 - "tools.ts"
Cohesion: 0.12
Nodes (10): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions, getQueueLength() (+2 more)

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.13
Nodes (22): ComposeContext, composeMessages(), lastUserIdx(), stripReasoning(), ToolCallRecord, handleAskUser(), handleCreatePlan(), handleTaskComplete() (+14 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.15
Nodes (19): updateProvider(), ApprovalDialog(), ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory() (+11 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.16
Nodes (11): CharacterSnapshotContent, CharacterRevisionSnapshot, CHAR_DIR, CharacterMemory, CharacterRecord, DATA_DIR, normalizeRecord(), pathFor() (+3 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.16
Nodes (10): detectDoomLoop(), evaluateFinalAnswer(), evaluateSubmission(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, estimateTokens(), shouldCompact() (+2 more)

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.12
Nodes (16): createEventDefinition(), CreateEventDefinitionInput, EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences(), fireEventDefinition(), retryEventOccurrence() (+8 more)

### Community 25 - "apiGet"
Cohesion: 0.14
Nodes (23): deleteCharacter(), apiDelete(), apiGet(), apiPost(), createProvider(), deleteProvider(), fetchBuiltinProviders(), fetchCustomProviders() (+15 more)

### Community 26 - "control-router.ts"
Cohesion: 0.18
Nodes (15): InnerResult, SubAgentRequestData, SubmissionCheckResult, CompactResult, AskUserOutcome, CreatePlanOutcome, handleSubAgentRequest(), SubAgentOutcome (+7 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.25
Nodes (15): apiPut(), fetchDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+7 more)

### Community 28 - "goals.ts"
Cohesion: 0.29
Nodes (12): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+4 more)

### Community 29 - "index.ts"
Cohesion: 0.12
Nodes (15): messageStore, app, httpServer, io, router, router, router, setGoalRuntime() (+7 more)

### Community 30 - "context-builder.ts"
Cohesion: 0.22
Nodes (12): ProviderCapability, resolveProviderFormat(), textPart, buildInitialMessages(), DATA_DIR, DEFAULT_PROMPT_FILE, expandContextReferences(), fixOrphanToolCalls() (+4 more)

### Community 31 - "tools.ts"
Cohesion: 0.17
Nodes (14): createMCPServer(), deleteMCPServer(), fetchTools(), MCPConnectionStatus, MCPServer, MCPTestResult, testMCPConnection(), ToolMeta (+6 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.23
Nodes (8): fetchCharacterPresence(), connectSocket(), getSocket(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 33 - "MessageItem.tsx"
Cohesion: 0.23
Nodes (7): MessageItem(), Props, showReasoning(), Props, icons, Props, Message

### Community 34 - "Sidebar.vue"
Cohesion: 0.24
Nodes (14): removeSessionState(), abortSession(), SessionState, setSessionStrategy(), states, isStrategyInput(), LEGACY_STRATEGY_MAP, LegacyStrategy (+6 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.18
Nodes (15): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderContentBlock (+7 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.13
Nodes (16): Config, CONFIG_FILE, __dirname, getDataDir(), isConfigured(), loadConfig(), setDataDir(), DATA_DIR (+8 more)

### Community 38 - "validate.ts"
Cohesion: 0.13
Nodes (8): tool, tool, coerceBoolean, coerceNumber, validate(), ValidationError, tool, turndown

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.25
Nodes (5): DATA_DIR, defaults, EvolutionConfig, FILE, router

### Community 40 - "InputToolbar.vue"
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 41 - "MessageItem.vue"
Cohesion: 0.33
Nodes (5): AttachmentMeta, DATA_DIR, extFor(), MEDIA_DIR, saveAttachment()

### Community 42 - "sub-agent.ts"
Cohesion: 0.31
Nodes (10): mergeContent(), getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints() (+2 more)

### Community 43 - "matchers.ts"
Cohesion: 0.23
Nodes (13): collapseWhitespace(), contextAwareMatch(), exactMatch(), findBestMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers (+5 more)

### Community 45 - "toolStore.ts"
Cohesion: 0.20
Nodes (8): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, migrateFromOldFile(), OLD_FILE, readByName(), writeByName()

### Community 46 - "skill-loader.ts"
Cohesion: 0.24
Nodes (12): buildSkillIndex(), DATA_DIR, extractTianshuArray(), findSkillByName(), findSkillDir(), listFiles(), parseFrontmatter(), skillDirFor() (+4 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.44
Nodes (10): buildCompactionSummary(), compactHistory(), extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary(), contentToText() (+2 more)

### Community 48 - "context-references.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.19
Nodes (10): DATA_DIR, ensureIds(), FILE, ModelInfo, ProviderRecord, providerStore, readAll(), writeAll() (+2 more)

### Community 50 - "errors.ts"
Cohesion: 0.43
Nodes (4): describeTransportError(), getErrorCode(), isTransientLLMError(), described

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.26
Nodes (9): scanCommandPaths(), tool, assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), PathEscapeError, realRoot(), replaceAllOccurrences() (+1 more)

### Community 53 - "registry.ts"
Cohesion: 0.19
Nodes (13): executeTool(), parseMCPToolName(), tool, byName, execute(), IGNORE_DIRS, init(), readToolJson() (+5 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.18
Nodes (11): CharacterBinding, ResolvedCharacterBinding, CharacterRevisionRow, characterRevisionStore, makeSnapshot(), readVisual(), CHAR_DIR, characterContentStore (+3 more)

### Community 56 - "GeneralEventSettings.vue"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 57 - "sessions.ts"
Cohesion: 0.33
Nodes (3): db, NOW, tmpData

### Community 58 - "skills.ts"
Cohesion: 0.40
Nodes (5): ensureDir(), getOutputDir(), truncateError(), truncateToolOutput(), TRUNCATION_DIR

### Community 59 - "App.tsx"
Cohesion: 0.50
Nodes (4): DATA_DIR, DEBUG_DIR, logLLMCall(), systemPromptFingerprint()

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 62 - "skills.ts"
Cohesion: 0.24
Nodes (9): DATA_DIR, findSkills(), parseFrontmatter(), parseList(), router, SkillDetail, SkillFile, SkillMeta (+1 more)

### Community 63 - "types.ts"
Cohesion: 0.67
Nodes (3): CharactersPage(), roleLabels, timeAgo()

### Community 65 - "index.ts"
Cohesion: 0.67
Nodes (3): fuzzySuggest(), similarity(), tool

### Community 66 - "index.ts"
Cohesion: 0.20
Nodes (4): LOG_DIR, ShellInfo, TEMP_DIR, tool

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 69 - "sessionStore.ts"
Cohesion: 0.25
Nodes (11): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), DATA_DIR, getDb() (+3 more)

### Community 75 - "workspace.ts"
Cohesion: 0.36
Nodes (5): browseDirectory(), BrowseResult, DirEntry, resolvePath(), Props

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
- **333 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+328 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getDataDir()` connect `cronRegistry.ts` to `sessionStore.ts`, `CharacterSelector.vue`, `RoleSettings.vue`, `outer.ts`, `MessageItem.vue`, `offlineMiner.ts`, `toolStore.ts`, `skill-loader.ts`, `providerStore.ts`, `characterStore.ts`, `MarkdownRenderer.vue`, `skills.ts`, `App.tsx`, `context-builder.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `getDb()` connect `sessionStore.ts` to `Sidebar.vue`, `dependencies`, `chat.ts`, `RoleSettings.vue`, `offlineMiner.ts`, `WorkspacePicker.vue`, `useChatStore`, `MarkdownRenderer.vue`, `index.ts`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `sessionLoop()` connect `outer.ts` to `Sidebar.vue`, `attachments.ts`, `chat.ts`, `toolStore.ts`, `sub-agent.ts`, `offlineMiner.ts`, `context-compactor.ts`, `WorkspacePicker.vue`, `useChatStore`, `loop.test.ts`, `context-builder.ts`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _333 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.12648221343873517 - nodes in this community are weakly interconnected._