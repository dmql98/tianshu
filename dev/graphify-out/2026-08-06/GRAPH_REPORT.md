# Graph Report - dev  (2026-08-06)

## Corpus Check
- 250 files · ~181,526 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1326 nodes · 2873 edges · 107 communities (78 shown, 29 thin omitted)
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
- toolStore.ts
- index.ts
- 弈 (Yì) — AI Agent 系统
- session.ts
- definitions.ts
- AvatarCropDialog.tsx
- approval-registry.ts
- providerStore.ts
- ChatArea.tsx
- media-store.ts
- normalize-skill-frontmatter.mjs
- workspace.ts
- errors.ts
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
- `App()` --calls--> `fetchDataspace()`  [EXTRACTED]
  web/client/src/App.tsx → web/client/src/api/config.ts
- `fetchChildSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `fetchSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts
- `renameSession()` --calls--> `apiPut()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts

## Import Cycles
- 2-file cycle: `web/server/src/agent/inner.ts -> web/server/src/agent/loop/completion-evaluator.ts -> web/server/src/agent/inner.ts`
- 3-file cycle: `web/server/src/agent/loop.ts -> web/server/src/agent/outer.ts -> web/server/src/event/event-run-adapter.ts -> web/server/src/agent/loop.ts`

## Communities (107 total, 29 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.29
Nodes (3): db, NOW, tmpData

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (46): better-sqlite3, glob, hono, @hono/node-server, htmlparser2, iconv-lite, jsdom, @modelcontextprotocol/sdk (+38 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.44
Nodes (7): runAssetGC(), startAssetGC(), assetIdsFromVisual(), hasProtectingRef(), registerAssetRefs(), touchPlayerLease(), getDb()

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
Cohesion: 0.21
Nodes (14): DATA_DIR, EventDefinitionRow, eventDefinitionStore, broadcastSocket(), drainQueue(), executeOccurrence(), scheduleOccurrence(), claimDue() (+6 more)

### Community 7 - "index.ts"
Cohesion: 0.12
Nodes (19): createCharacter(), fetchCharacter(), fetchCharacterStats(), updateCharacter(), updateCharacterSkillBinding(), EditFieldProps, CharacterDetailPage(), roleLabels (+11 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.13
Nodes (18): CharacterPresence, characterPresenceProjector, mapEvent(), MOTIONS, characterRevisionStore, assetDir(), assetIndexPath(), CharacterAssetKind (+10 more)

### Community 9 - "outer.ts"
Cohesion: 0.10
Nodes (34): assembleStaticPrompt(), resolveDataspace(), resolveWorkspace(), resolveWorkspaces(), getControlToolDefinitions(), RunResult, sessionLoop(), cachePath() (+26 more)

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
Cohesion: 0.15
Nodes (21): createDurableSocket(), publishRunEvent(), unwrapDurableSocket(), abortSession(), enqueueRun(), getQueueLength(), getRunState(), RunState (+13 more)

### Community 15 - "apiGet"
Cohesion: 0.19
Nodes (16): apiGet(), createProvider(), fetchBuiltinProviders(), fetchCustomProviders(), fetchProviderModels(), fetchProviders(), ProviderModel, updateProvider() (+8 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.18
Nodes (15): InnerResult, SubmissionCheckResult, AskUserOutcome, CreatePlanOutcome, handleSubAgentRequest(), SubAgentOutcome, SubmitResultOutcome, UpdatePlanStepOutcome (+7 more)

### Community 17 - "tools.ts"
Cohesion: 0.18
Nodes (7): CancelScope, completeRun(), executeRun(), QueuedRun, runCoordinator, SessionEntry, sessions

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.16
Nodes (18): checkStrategy(), checkToolBinding(), deepCloneToolCall(), estimateTokenCount(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS, retries (+10 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.21
Nodes (15): fetchCharacters(), updateSession(), CharacterPicker(), Props, dirOf(), extractPath(), FileEntry, FilePanel() (+7 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.21
Nodes (9): executeTool(), parseMCPToolName(), byName, execute(), getFilteredDefinitions(), IGNORE_DIRS, init(), readToolJson() (+1 more)

### Community 22 - "loop.test.ts"
Cohesion: 0.15
Nodes (12): markdown-it, markdown-it, MarkdownContent(), md, Props, MessageItem(), Props, showReasoning() (+4 more)

### Community 23 - "eventExecutor.ts"
Cohesion: 0.20
Nodes (12): CronFields, dayOfWeek(), daysInMonth(), LocalParts, NextFireOptions, nextFireTime(), normalizeClock(), parseCronExpression() (+4 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.21
Nodes (18): archiveEventDefinition(), createEventDefinition(), CreateEventDefinitionInput, deleteEventDefinition(), EventDefinition, EventOccurrence, fetchEventDefinitions(), fetchEventOccurrences() (+10 more)

### Community 25 - "apiGet"
Cohesion: 0.17
Nodes (21): ProviderCapability, ComposeContext, handleAskUser(), handleCreatePlan(), handleTaskComplete(), handleUpdatePlanStep(), LoopEngineContext, persistComposeChanges() (+13 more)

### Community 26 - "loop.test.ts"
Cohesion: 0.42
Nodes (10): buildCompactionSummary(), compactHistory(), CompactResult, extractPreviousSummary(), llmSummarize(), selectAndSummarize(), selectEntries(), serializeForSummary() (+2 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.25
Nodes (15): apiPut(), fetchDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+7 more)

### Community 28 - "goals.ts"
Cohesion: 0.22
Nodes (14): apiPatch(), createGoal(), fetchActivePlan(), fetchGoals(), Goal, patchGoal(), pauseGoal(), Plan (+6 more)

### Community 29 - "index.ts"
Cohesion: 0.26
Nodes (7): fetchCharacterPresence(), connectSocket(), ChatInput(), EVENT_TYPES, eventMotion(), SemanticEvent, useCharacterPresence()

### Community 30 - "context-builder.ts"
Cohesion: 0.15
Nodes (17): ProviderFormat, resolveProviderFormat(), textPart, buildInitialMessages(), DATA_DIR, DEFAULT_PROMPT_FILE, expandContextReferences(), fixOrphanToolCalls() (+9 more)

### Community 31 - "tools.ts"
Cohesion: 0.13
Nodes (19): createMCPServer(), deleteMCPServer(), DiscoveredMCPServer, discoverMCPServers(), DiscoverResult, fetchTools(), ImportMCPResult, importMCPServers() (+11 more)

### Community 32 - "ChatInput.tsx"
Cohesion: 0.16
Nodes (11): CharacterSnapshotContent, CharacterRevisionSnapshot, CHAR_DIR, CharacterMemory, CharacterRecord, DATA_DIR, normalizeRecord(), pathFor() (+3 more)

### Community 34 - "Sidebar.vue"
Cohesion: 0.21
Nodes (13): deleteCharacter(), apiDelete(), apiPost(), deleteProvider(), createSession(), deleteSession(), fetchChildSessions(), fetchSessions() (+5 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.25
Nodes (5): db, newChar(), NOW, seedCharacter(), tmpData

### Community 36 - "attachments.ts"
Cohesion: 0.13
Nodes (25): CLAUDE_SPEC, collect(), configPaths(), CURSOR_SPEC, dedupe(), discoverClaudeServers(), discoverCursorServers(), DiscoveredMCPServer (+17 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.17
Nodes (13): makeSnapshot(), readVisual(), Config, CONFIG_FILE, __dirname, getDataDir(), isConfigured(), loadConfig() (+5 more)

### Community 38 - "validate.ts"
Cohesion: 0.12
Nodes (10): tool, tool, fuzzySuggest(), similarity(), tool, coerceBoolean, coerceNumber, validate() (+2 more)

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.12
Nodes (17): runStore, messageStore, providerStore, sessionStore, setEventDefinitionRuntime(), app, httpServer, io (+9 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.20
Nodes (14): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderContentBlock (+6 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.18
Nodes (3): App(), navItems, KnowledgePage()

### Community 42 - "sub-agent.ts"
Cohesion: 0.15
Nodes (9): ToolCallRecord, detectDoomLoop(), evaluateFinalAnswer(), evaluateSubmission(), FinalAnswerDecision, hasRepeatingPattern(), SubmissionCheckInput, LoopEngineResult (+1 more)

### Community 43 - "matchers.ts"
Cohesion: 0.29
Nodes (11): collapseWhitespace(), contextAwareMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch(), matchers, MatchResult, normalizeLineEndings() (+3 more)

### Community 45 - "client.ts"
Cohesion: 0.25
Nodes (6): DATA_DIR, DEBUG_DIR, mergeOldDebugTurns(), DATA_DIR, DEBUG_DIR, tool

### Community 46 - "skill-loader.ts"
Cohesion: 0.09
Nodes (38): SessionSkillActivation, sessionSkillStore, ensureInside(), fileType(), findSkillPackage(), listFiles(), listSkillPackages(), parseSkillFrontmatter() (+30 more)

### Community 47 - "context-compactor.ts"
Cohesion: 0.19
Nodes (10): checkpointService, PendingApprovalState, CheckpointRow, checkpointStore, PHASE_BY_EVENT, RAW_SOCKET, RunEventRow, runEventStore (+2 more)

### Community 48 - "context-references.ts"
Cohesion: 0.20
Nodes (9): ALLOWED_TRANSITIONS, RunRow, RunStatus, TERMINAL, CharacterBinding, resolveCharacterBinding(), ResolvedCharacterBinding, CharacterRevisionRow (+1 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.42
Nodes (6): fallbackSessionTitle(), generateSessionTitle(), normalizeGeneratedTitle(), truncateChars(), parseUsage(), streamChatCompletion()

### Community 50 - "goals.ts"
Cohesion: 0.16
Nodes (12): mcpServerStore, router, TOOLS_DIR, classifyConnectError(), connectionTimeoutMs(), connectMCPServer(), MCPServerConfig, MCPToolDef (+4 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.23
Nodes (13): tool, exactMatch(), findBestMatch(), assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), isPathWithin(), normalizePathForPlatform() (+5 more)

### Community 53 - "registry.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.25
Nodes (5): DATA_DIR, defaults, EvolutionConfig, FILE, router

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
Cohesion: 0.19
Nodes (11): CHAR_DIR, characterContentStore, DATA_DIR, characterMetaStore, tool, parseSkillNames(), parsed, toolBindings (+3 more)

### Community 60 - "ProviderPlugin"
Cohesion: 0.18
Nodes (6): plugin, plugin, plugin, plugin, ProviderPlugin, plugin

### Community 61 - "index.ts"
Cohesion: 0.18
Nodes (4): pluginIndex, plugins, plugin, plugin

### Community 62 - "run-store.ts"
Cohesion: 0.24
Nodes (8): tool, tool, tool, ConstraintField, ToolConstraint, ToolContext, ToolModule, ToolResult

### Community 65 - "toolStore.ts"
Cohesion: 0.20
Nodes (8): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, migrateFromOldFile(), OLD_FILE, readByName(), writeByName()

### Community 66 - "index.ts"
Cohesion: 0.13
Nodes (13): controller, marker, workspace, getShellCandidates(), gitBashPaths(), isProcessRunning(), killProcessTree(), LOG_DIR (+5 more)

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 68 - "session.ts"
Cohesion: 0.29
Nodes (9): SubAgentRequestData, approveToolForSession(), getSessionState(), isToolApprovedForSession(), removeSessionState(), SessionState, setSessionStrategy(), states (+1 more)

### Community 69 - "definitions.ts"
Cohesion: 0.36
Nodes (9): mergeContent(), getCharacterToolDefinitions(), getDangerousTools(), matchPath(), parseFileSize(), resolveCharacterTools(), validateByRule(), validateConstraints() (+1 more)

### Community 70 - "AvatarCropDialog.tsx"
Cohesion: 0.47
Nodes (7): AvatarCrop, avatarCropStyle(), clamp(), normalizeAvatarCrop(), AvatarCropDialog(), clamp(), Props

### Community 71 - "approval-registry.ts"
Cohesion: 0.36
Nodes (6): ApprovalChoice, approvalRegistry, PendingApproval, pendingBySession, assert(), main()

### Community 72 - "providerStore.ts"
Cohesion: 0.32
Nodes (7): DATA_DIR, ensureIds(), FILE, ModelInfo, ProviderRecord, readAll(), writeAll()

### Community 73 - "ChatArea.tsx"
Cohesion: 0.38
Nodes (3): ChatArea(), isCompact(), MessageList()

### Community 74 - "media-store.ts"
Cohesion: 0.33
Nodes (5): AttachmentMeta, DATA_DIR, extFor(), MEDIA_DIR, saveAttachment()

### Community 75 - "normalize-skill-frontmatter.mjs"
Cohesion: 0.83
Nodes (3): normalize(), scalar(), walk()

### Community 76 - "workspace.ts"
Cohesion: 0.29
Nodes (4): DirEntry, HOME, QUICK_ACCESS, workspaceRouter

### Community 77 - "errors.ts"
Cohesion: 0.47
Nodes (3): describeTransportError(), getErrorCode(), described

### Community 81 - "index.ts"
Cohesion: 0.50
Nodes (3): hasBOM(), stripBOM(), tool

### Community 82 - "copy-tool-json.js"
Cohesion: 0.50
Nodes (3): dest, __dirname, src

## Knowledge Gaps
- **371 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+366 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `expandContextReferences()` connect `context-builder.ts` to `registry.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `getDataDir()` connect `cronRegistry.ts` to `ChatInput.tsx`, `toolStore.ts`, `toolStore.ts`, `RoleSettings.vue`, `outer.ts`, `media-store.ts`, `providerStore.ts`, `offlineMiner.ts`, `client.ts`, `skill-loader.ts`, `useChatStore`, `MarkdownRenderer.vue`, `App.tsx`, `context-builder.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `CancelScope` connect `tools.ts` to `toolStore.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _371 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11857707509881422 - nodes in this community are weakly interconnected._