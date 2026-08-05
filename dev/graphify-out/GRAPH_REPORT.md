# Graph Report - dev  (2026-08-05)

## Corpus Check
- 248 files · ~180,549 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1317 nodes · 2856 edges · 99 communities (71 shown, 28 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `59e7b40d`
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
- DisplaySettings.vue
- index.ts
- 弈 (Yì) — AI Agent 系统
- config.ts
- AvatarCropDialog.tsx
- normalize-skill-frontmatter.mjs
- llm-logger.ts
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
- `spawnAndRunSubAgent()` --indirect_call--> `terminalStatus()`  [INFERRED]
  web/server/src/agent/sub-agent.ts → web/server/src/agent/runtime/run-event-store.ts
- `fetchChildSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `fetchSessionMessages()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `fetchSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `CompactResult` --references--> `LLMMessage`  [EXTRACTED]
  web/server/src/agent/loop/context-compactor.ts → web/server/src/llm/client.ts

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
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

### Community 3 - "EventsView.vue"
Cohesion: 0.08
Nodes (24): 08：桌面角色窗口已取消, 08：资源生命周期 —— ✅ 已收口（2026-07-31 第二轮）, 1. 任务背景, 2.1 Run、RunEvent 与持久事件骨架, 2.2 CharacterDefinition / CharacterRevision, 2.3 消息 revision 与会话分支, 2.4 08 第一阶段：资源、Renderer 与 Presence, 2.5 角色资源引用保护与包 (+16 more)

### Community 4 - "dependencies"
Cohesion: 0.24
Nodes (10): createSkillPackage(), fetchSkillChild(), fetchSkillPackage(), SkillChildDetail, SkillFile, SkillPackageChild, SkillPackageDetail, SkillPackageMeta (+2 more)

### Community 5 - "chat.ts"
Cohesion: 0.20
Nodes (8): browseDirectory(), BrowseResult, DirEntry, openInFileManager(), resolvePath(), Props, ProjectContextMenu, SessionPanel()

### Community 6 - "toolStore.ts"
Cohesion: 0.21
Nodes (15): DATA_DIR, EventDefinitionRow, eventDefinitionStore, broadcastSocket(), drainQueue(), executeOccurrence(), fireOnceEvent(), scheduleOccurrence() (+7 more)

### Community 7 - "index.ts"
Cohesion: 0.10
Nodes (20): MessageItem(), Props, showReasoning(), ContextMenu, Props, icons, Props, ChatState (+12 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.06
Nodes (40): CharacterSnapshotContent, CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, CharacterRevisionSnapshot, CHAR_DIR, characterContentStore (+32 more)

### Community 9 - "outer.ts"
Cohesion: 0.09
Nodes (35): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), CONTROL_TOOL_NAMES, ControlToolDefinition, getControlToolDefinitions(), RunResult (+27 more)

### Community 10 - "package.json"
Cohesion: 0.06
Nodes (30): react, react-dom, react-router-dom, socket.io-client, @types/react, @types/react-dom, vite, @vitejs/plugin-react (+22 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.11
Nodes (21): lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary, TrajectoryCluster, defaultOptions (+13 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.12
Nodes (18): cancelRun(), fetchRecentRuns(), fetchRunEvents(), RunRow, submitRunInput(), AskUserDialog(), applyRunEvents(), Attachment (+10 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.13
Nodes (29): CharacterAssetRef, characterAssetUrl(), CharacterMotion, CharacterVisual, CharacterVisualResponse, exportCharacterPackage(), fetchCharacterPresence(), fetchCharacterVisual() (+21 more)

### Community 14 - "inner.ts"
Cohesion: 0.15
Nodes (19): saveAttachment(), createDurableSocket(), publishRunEvent(), unwrapDurableSocket(), abortSession(), enqueueRun(), getQueueLength(), getRunState() (+11 more)

### Community 15 - "apiGet"
Cohesion: 0.20
Nodes (15): apiGet(), createProvider(), fetchBuiltinProviders(), fetchCustomProviders(), fetchProviderModels(), fetchProviders(), ProviderModel, updateProvider() (+7 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.12
Nodes (21): createCharacter(), fetchCharacter(), fetchCharacters(), fetchCharacterStats(), updateCharacter(), updateCharacterSkillBinding(), updateSession(), fetchSkillPackages() (+13 more)

### Community 17 - "tools.ts"
Cohesion: 0.15
Nodes (8): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions, runStore

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.15
Nodes (23): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS, retries (+15 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.19
Nodes (14): ApprovalDialog(), ChatArea(), dirOf(), extractPath(), FileEntry, FilePanel(), openDirectory(), isCompact() (+6 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.16
Nodes (16): getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), validateByRule(), validateConstraints(), executeTool(), parseMCPToolName() (+8 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.20
Nodes (8): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, migrateFromOldFile(), OLD_FILE, readByName(), writeByName()

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (18): archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences() (+10 more)

### Community 25 - "apiGet"
Cohesion: 0.16
Nodes (26): ComposeContext, InnerResult, SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, handleAskUser(), handleCreatePlan(), handleSubAgentRequest() (+18 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.22
Nodes (16): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+8 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.24
Nodes (15): apiPut(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt(), saveDefaultPrompt() (+7 more)

### Community 28 - "goals.ts"
Cohesion: 0.21
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.16
Nodes (12): mcpServerStore, router, TOOLS_DIR, classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), MCPServerConfig, MCPToolDef (+4 more)

### Community 30 - "context-builder.ts"
Cohesion: 0.27
Nodes (7): tool, tool, tool, ConstraintField, ToolContext, ToolModule, ToolResult

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.43
Nodes (4): describeTransportError(), getErrorCode(), isTransientLLMError(), described

### Community 34 - "Sidebar.vue"
Cohesion: 0.21
Nodes (13): deleteCharacter(), apiDelete(), apiPost(), deleteProvider(), createSession(), deleteSession(), fetchChildSessions(), fetchSessionMessages() (+5 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.13
Nodes (25): CLAUDE_SPEC, collect(), configPaths(), CURSOR_SPEC, dedupe(), discoverClaudeServers(), discoverCursorServers(), DiscoveredMCPServer (+17 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.25
Nodes (6): DATA_DIR, DEBUG_DIR, mergeOldDebugTurns(), DATA_DIR, DEBUG_DIR, tool

### Community 38 - "validate.ts"
Cohesion: 0.12
Nodes (10): tool, tool, fuzzySuggest(), similarity(), tool, coerceBoolean, coerceNumber, validate() (+2 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.25
Nodes (5): DATA_DIR, defaults, EvolutionConfig, FILE, router

### Community 40 - "InputToolbar.vue"
Cohesion: 0.12
Nodes (27): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderCapability (+19 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.20
Nodes (4): fetchDataspace(), App(), navItems, KnowledgePage()

### Community 42 - "sub-agent.ts"
Cohesion: 0.15
Nodes (9): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), evaluateSubmission(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, LoopEngineResult (+1 more)

### Community 43 - "matchers.ts"
Cohesion: 0.26
Nodes (12): collapseWhitespace(), contextAwareMatch(), findBestMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers, MatchResult (+4 more)

### Community 45 - "client.ts"
Cohesion: 0.44
Nodes (5): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars(), router

### Community 46 - "skill-loader.ts"
Cohesion: 0.09
Nodes (38): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+30 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.21
Nodes (9): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore, PHASE_BY_EVENT, RAW_SOCKET, RunEventRow, terminalStatus() (+1 more)

### Community 48 - "context-references.ts"
Cohesion: 0.13
Nodes (20): ALLOWED_TRANSITIONS, RunRow, RunStatus, TERMINAL, runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef() (+12 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.21
Nodes (9): DATA_DIR, ensureIds(), FILE, ModelInfo, ProviderRecord, providerStore, readAll(), writeAll() (+1 more)

### Community 50 - "goals.ts"
Cohesion: 0.10
Nodes (21): goalStore, PlanRow, PlanStepRow, PlanStepStatus, planStore, runEventStore, messageStore, TurnRow (+13 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.25
Nodes (11): scanCommandPaths(), tool, exactMatch(), assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin(), normalizePathForPlatform() (+3 more)

### Community 53 - "registry.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.33
Nodes (4): AttachmentMeta, DATA_DIR, extFor(), MEDIA_DIR

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
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 66 - "index.ts"
Cohesion: 0.11
Nodes (17): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+9 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 69 - "config.ts"
Cohesion: 0.23
Nodes (10): Config, CONFIG_FILE, __dirname, getDataDir(), isConfigured(), loadConfig(), setDataDir(), DATA_DIR (+2 more)

### Community 70 - "AvatarCropDialog.tsx"
Cohesion: 0.47
Nodes (7): AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog(), clamp(), Props

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

### Community 76 - "llm-logger.ts"
Cohesion: 0.50
Nodes (4): DATA_DIR, DEBUG_DIR, logLLMCall(), systemPromptFingerprint()

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
- **368 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+363 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **28 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `expandContextReferences()` connect `InputToolbar.vue` to `registry.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `getDataDir()` connect `config.ts` to `cronRegistry.ts`, `toolStore.ts`, `CharacterSelector.vue`, `InputToolbar.vue`, `outer.ts`, `RoleSettings.vue`, `offlineMiner.ts`, `llm-logger.ts`, `skill-loader.ts`, `context-references.ts`, `providerStore.ts`, `loop.test.ts`, `MarkdownRenderer.vue`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `getDb()` connect `context-references.ts` to `toolStore.ts`, `RoleSettings.vue`, `offlineMiner.ts`, `client.ts`, `inner.ts`, `skill-loader.ts`, `context-compactor.ts`, `goals.ts`, `useChatStore`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _368 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10153846153846154 - nodes in this community are weakly interconnected._