# Graph Report - dev  (2026-07-30)

## Corpus Check
- 285 files · ~181,446 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1580 nodes · 2792 edges · 120 communities (89 shown, 31 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1a5ad167`
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
- config.ts
- eventExecutor.ts
- EventsPage.tsx
- apiGet
- SessionItem.vue
- SettingsPage.tsx
- client.ts
- index.ts
- McpView.vue
- tools.ts
- chat.ts
- ChatInput.vue
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
- TokenBar.vue
- skill-loader.ts
- SessionSettings.vue
- context-references.ts
- providerStore.ts
- compilerOptions
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
- App.vue
- sessionStore.ts
- characters.ts
- OutlinePanel.vue
- AgentSettings.vue
- SettingsView.vue
- WorkspaceGroup.vue
- workspace.ts
- ToolSettings.vue
- markdown-it.d.ts
- markdown-it.d.ts
- index.ts
- FilesPanel.vue
- index.ts
- copy-tool-json.js
- electron.d.ts
- RouteBar.tsx
- electron.d.ts
- AGENTS.md
- SettingsBtn.vue
- TaskView.vue
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
1. `sessionLoop()` - 39 edges
2. `ProviderPlugin` - 36 edges
3. `apiGet()` - 30 edges
4. `apiGet()` - 25 edges
5. `useChatStore` - 25 edges
6. `useChatStore` - 24 edges
7. `apiPost()` - 20 edges
8. `getDataDir()` - 20 edges
9. `apiPost()` - 19 edges
10. `@/api/sessions` - 19 edges

## Surprising Connections (you probably didn't know these)
- `deleteCharacter()` --calls--> `apiDelete()`  [EXTRACTED]
  web/client-old/src/api/characters.ts → web/client-old/src/api/client.ts
- `createProvider()` --calls--> `apiPost()`  [EXTRACTED]
  web/client-old/src/api/providers.ts → web/client-old/src/api/client.ts
- `deleteEvent()` --calls--> `apiDelete()`  [EXTRACTED]
  web/client-old/src/api/events.ts → web/client-old/src/api/client.ts
- `deleteMCPServer()` --calls--> `apiDelete()`  [EXTRACTED]
  web/client-old/src/api/tools.ts → web/client-old/src/api/client.ts
- `fetchChildSessions()` --calls--> `apiGet()`  [EXTRACTED]
  web/client/src/api/sessions.ts → web/client/src/api/client.ts

## Import Cycles
- None detected.

## Communities (120 total, 31 thin omitted)

### Community 0 - "chatStore.ts"
Cohesion: 0.06
Nodes (39): connectSocket(), getSocket(), ApprovalDialog(), ChatArea(), ChatInput(), dirOf(), extractPath(), FileEntry (+31 more)

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (46): better-sqlite3, glob, hono, @hono/node-server, htmlparser2, iconv-lite, jsdom, @modelcontextprotocol/sdk (+38 more)

### Community 2 - "SkillSettings.vue"
Cohesion: 0.07
Nodes (30): fetchSkillDetail(), fetchSkillFile(), fetchSkills(), FileContent, SkillDetail, SkillFile, SkillMeta, addTag() (+22 more)

### Community 3 - "EventsView.vue"
Cohesion: 0.06
Nodes (23): availableChars, charactersStore, chatStore, createError, creating, events, expandedCards, filterStatus (+15 more)

### Community 4 - "dependencies"
Cohesion: 0.06
Nodes (34): highlight.js, markdown-it, pinia, @vitejs/plugin-vue, vue, vue-i18n, @vue-js-cron/light, vue-router (+26 more)

### Community 5 - "chat.ts"
Cohesion: 0.09
Nodes (21): CancelScope, AttachmentMeta, DATA_DIR, extFor(), MEDIA_DIR, saveAttachment(), removeSessionState(), abortSession() (+13 more)

### Community 6 - "toolStore.ts"
Cohesion: 0.08
Nodes (23): configPath(), DATA_DIR, MCP_DIR, MCPServerRecord, mcpServerStore, migrateFromOldFile(), OLD_FILE, readByName() (+15 more)

### Community 7 - "index.ts"
Cohesion: 0.13
Nodes (25): fetchCharacter(), fetchCharacters(), fetchCharacterStats(), updateCharacter(), updateSession(), fetchSkills(), CharacterPicker(), Props (+17 more)

### Community 8 - "RoleSettings.vue"
Cohesion: 0.06
Nodes (18): activeTab, allSkills, allTools, displayGroups, editContent, editingSection, filteredCharacters, form (+10 more)

### Community 9 - "outer.ts"
Cohesion: 0.14
Nodes (32): resolveProviderFormat(), textPart, assembleStaticPrompt(), buildCompactionSummary(), compactHistory(), contentToText(), DATA_DIR, DEFAULT_PROMPT_FILE (+24 more)

### Community 10 - "package.json"
Cohesion: 0.06
Nodes (30): react, react-dom, react-router-dom, @types/react, @types/react-dom, @vitejs/plugin-react, dependencies, react (+22 more)

### Community 11 - "offlineMiner.ts"
Cohesion: 0.11
Nodes (21): CreateTrajectoryInput, TrajectoryRow, lcs(), lengthTier(), OfflineMiner, parseToolCalls(), similarity(), ToolCallSummary (+13 more)

### Community 12 - "EvolutionSettings.vue"
Cohesion: 0.09
Nodes (27): clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), availableChars, characterId, charactersStore, clear() (+19 more)

### Community 13 - "ModelSelector.vue"
Cohesion: 0.08
Nodes (17): chatStore, currentLabel, dropdownRef, groups, open, providersStore, search, session (+9 more)

### Community 14 - "inner.ts"
Cohesion: 0.13
Nodes (24): checkStrategy(), checkToolBinding(), deepCloneToolCall(), detectDoomLoop(), hasRepeatingPattern(), innerLoop(), matchToolCall(), READ_ONLY_TOOLS (+16 more)

### Community 15 - "apiGet"
Cohesion: 0.11
Nodes (26): fetchCharacter(), fetchCharacters(), updateCharacter(), apiDelete(), apiGet(), apiPut(), fetchEvent(), fetchEvents() (+18 more)

### Community 16 - "WorkspacePicker.vue"
Cohesion: 0.11
Nodes (23): browseDirectory(), BrowseResult, DirEntry, resolvePath(), checked, confirmSelection(), currentPath, emit (+15 more)

### Community 17 - "tools.ts"
Cohesion: 0.12
Nodes (21): createCharacter(), apiPatch(), apiPost(), archiveEvent(), archiveOldEvents(), createEvent(), CreateEventInput, deleteEvent() (+13 more)

### Community 18 - "compilerOptions"
Cohesion: 0.09
Nodes (22): DOM, DOM.Iterable, ES2020, compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib (+14 more)

### Community 19 - "useChatStore"
Cohesion: 0.10
Nodes (17): chatStore, emit, hint, props, title, chatStore, label, chatStore (+9 more)

### Community 20 - "system-cache.ts"
Cohesion: 0.12
Nodes (18): cachePath(), capturePrefixShape(), FingerprintComponents, flatContent(), getCached(), memCache, PrefixShape, prevComponents (+10 more)

### Community 21 - "characterStore.ts"
Cohesion: 0.12
Nodes (15): CHAR_DIR, characterContentStore, DATA_DIR, CHAR_DIR, CharacterMemory, characterMetaStore, DATA_DIR, pathFor() (+7 more)

### Community 22 - "config.ts"
Cohesion: 0.13
Nodes (15): Config, CONFIG_FILE, __dirname, getDataDir(), isConfigured(), loadConfig(), setDataDir(), DATA_DIR (+7 more)

### Community 23 - "eventExecutor.ts"
Cohesion: 0.21
Nodes (15): executeEvent(), makeFakeSocket(), PROJECT_ROOT, poll(), scheduleImmediate(), startEventScheduler(), stopEventScheduler(), triggerAndRun() (+7 more)

### Community 24 - "EventsPage.tsx"
Cohesion: 0.18
Nodes (19): createCharacter(), apiPatch(), apiPost(), archiveEvent(), archiveOldEvents(), createEvent(), CreateEventInput, deleteEvent() (+11 more)

### Community 25 - "apiGet"
Cohesion: 0.20
Nodes (17): apiGet(), fetchEvent(), createProvider(), fetchBuiltinProviders(), fetchCustomProviders(), fetchProviderModels(), fetchProviders(), ProviderModel (+9 more)

### Community 26 - "SessionItem.vue"
Cohesion: 0.12
Nodes (16): emit, handleAction(), handleClickOutside(), menuItems, props, chatStore, children, contextMenuPos (+8 more)

### Community 27 - "SettingsPage.tsx"
Cohesion: 0.25
Nodes (15): apiPut(), fetchDataspace(), saveDataspace(), clearEvolutionConfig(), EvolutionConfig, fetchEvolutionConfig(), saveEvolutionConfig(), fetchDefaultPrompt() (+7 more)

### Community 28 - "client.ts"
Cohesion: 0.15
Nodes (15): ComposeContext, composeMessages(), lastUserIdx(), stripReasoning(), InnerResult, LLMChunk, LLMMessage, LLMOptions (+7 more)

### Community 29 - "index.ts"
Cohesion: 0.12
Nodes (14): EvolutionConfig, app, httpServer, io, router, router, router, DATA_DIR (+6 more)

### Community 30 - "McpView.vue"
Cohesion: 0.11
Nodes (8): editingMCP, importError, importJson, showImportModal, store, { t }, testingMap, testResults

### Community 31 - "tools.ts"
Cohesion: 0.17
Nodes (14): createMCPServer(), deleteMCPServer(), fetchTools(), MCPConnectionStatus, MCPServer, MCPTestResult, testMCPConnection(), ToolMeta (+6 more)

### Community 32 - "chat.ts"
Cohesion: 0.17
Nodes (12): connectSocket(), getSocket(), RunEvent, Strategy, chatStore, EventStatusChange, loadPersistedDefaults(), Message (+4 more)

### Community 33 - "ChatInput.vue"
Cohesion: 0.14
Nodes (15): chatStore, commandStrategies, ctx, handleSubmit(), inputDisabled, isEventSession, onKeydown(), onResizeEnd() (+7 more)

### Community 34 - "Sidebar.vue"
Cohesion: 0.12
Nodes (10): chatStore, chatStore, emit, filteredWorkspaces, filterType, router, emit, onInput() (+2 more)

### Community 35 - "ToolBindingEditor.vue"
Cohesion: 0.18
Nodes (14): ConstraintField, boolVal(), emit, expanded, getBinding(), getConstraint(), inputVal(), localList (+6 more)

### Community 36 - "attachments.ts"
Cohesion: 0.17
Nodes (16): AttachmentRecord, ContentPart, isImage(), isTextExtension(), isTextLike(), lowerContentToProvider(), mediaPart, ProviderCapability (+8 more)

### Community 37 - "cronRegistry.ts"
Cohesion: 0.17
Nodes (13): DATA_DIR, DEBUG_DIR, deleteOldDebugSessions(), mergeOldDebugTurns(), CronTask, lastRunByTask, registerCronTask(), startCronRegistry() (+5 more)

### Community 38 - "validate.ts"
Cohesion: 0.14
Nodes (7): tool, tool, coerceBoolean, coerceNumber, validate(), ValidationError, tool

### Community 39 - "CharacterSelector.vue"
Cohesion: 0.12
Nodes (14): charactersStore, chatStore, currentChar, currentCharGroups, currentLabel, filtered, grouped, groupView (+6 more)

### Community 40 - "InputToolbar.vue"
Cohesion: 0.14
Nodes (9): arrayBufferToBase64(), chatStore, fileInput, mimeFromExt(), onFilePicked(), session, showWorkspacePicker, { t } (+1 more)

### Community 41 - "MessageItem.vue"
Cohesion: 0.12
Nodes (10): copied, props, charCount, expanded, formattedDuration, props, chatStore, expanded (+2 more)

### Community 42 - "sub-agent.ts"
Cohesion: 0.21
Nodes (14): spawnAndRunSubAgent(), SubResult, SubSummary, validateSubAgentTarget(), CharacterRecord, getCharacterToolDefinitions(), getDangerousTools(), matchPath() (+6 more)

### Community 43 - "matchers.ts"
Cohesion: 0.21
Nodes (14): tool, collapseWhitespace(), contextAwareMatch(), exactMatch(), findBestMatch(), indentationFlexibleMatch(), levenshtein(), lineTrimmedMatch() (+6 more)

### Community 44 - "ProviderSettings.vue"
Cohesion: 0.15
Nodes (7): editingProvider, ensureModelEnabled(), fetchingModels, isModelEnabled(), store, { t }, toggleModel()

### Community 45 - "TokenBar.vue"
Cohesion: 0.13
Nodes (13): api, cacheStats, chatStore, compacted, ctx, inputPct, offset, outputPct (+5 more)

### Community 46 - "skill-loader.ts"
Cohesion: 0.24
Nodes (12): buildSkillIndex(), DATA_DIR, extractTianshuArray(), findSkillByName(), findSkillDir(), listFiles(), parseFrontmatter(), skillDirFor() (+4 more)

### Community 47 - "SessionSettings.vue"
Cohesion: 0.18
Nodes (11): fetchDefaultPrompt(), saveDefaultPrompt(), compact, defaultPrompt, defaultWorkspace, promptSaved, saveDefaultPrompt(), showCost (+3 more)

### Community 48 - "context-references.ts"
Cohesion: 0.26
Nodes (13): ContextReference, ContextReferenceResult, estimateTokenCount(), expandFileReference(), expandFolderReference(), expandUrlReference(), formatFileTree(), isSensitive() (+5 more)

### Community 49 - "providerStore.ts"
Cohesion: 0.19
Nodes (10): DATA_DIR, ensureIds(), FILE, ModelInfo, ProviderRecord, providerStore, readAll(), writeAll() (+2 more)

### Community 50 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, jsx, module, moduleResolution, paths, resolveJsonModule, skipLibCheck, strict (+3 more)

### Community 51 - "types.ts"
Cohesion: 0.17
Nodes (7): plugin, plugin, plugin, plugin, ModelCapabilities, ModelDefinition, ProviderFormat

### Community 52 - "utils.ts"
Cohesion: 0.24
Nodes (10): scanCommandPaths(), fuzzySuggest(), similarity(), tool, assertPathSafe(), assertPathSafeLegacy(), findFirstOccurrence(), realRoot() (+2 more)

### Community 53 - "registry.ts"
Cohesion: 0.23
Nodes (8): executeTool(), parseMCPToolName(), byName, execute(), IGNORE_DIRS, init(), readToolJson(), PathEscapeError

### Community 54 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck, strict (+3 more)

### Community 55 - "MarkdownRenderer.vue"
Cohesion: 0.18
Nodes (7): codeRef, copied, props, md, props, RenderSegment, segments

### Community 56 - "GeneralEventSettings.vue"
Cohesion: 0.18
Nodes (6): activeSubTab, { t }, archiveHours, blockEventInterrupt, schedulerInterval, { t }

### Community 57 - "sessions.ts"
Cohesion: 0.22
Nodes (10): deleteCharacter(), apiDelete(), deleteProvider(), createSession(), deleteSession(), fetchChildSessions(), fetchSessionMessages(), fetchSessions() (+2 more)

### Community 58 - "skills.ts"
Cohesion: 0.25
Nodes (9): fetchSkillDetail(), fetchSkillFile(), FileContent, SkillDetail, SkillFile, SkillMeta, categoryLabels, fileTypeIcons (+1 more)

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
Cohesion: 0.31
Nodes (7): tool, tool, tool, ConstraintField, ToolContext, ToolModule, ToolResult

### Community 64 - "DisplaySettings.vue"
Cohesion: 0.27
Nodes (7): brightness, langOptions, onLangChange(), { t }, themeOptions, i18n, setLocale()

### Community 65 - "index.ts"
Cohesion: 0.22
Nodes (3): app, router, router

### Community 66 - "index.ts"
Cohesion: 0.20
Nodes (4): LOG_DIR, ShellInfo, TEMP_DIR, tool

### Community 67 - "弈 (Yì) — AI Agent 系统"
Cohesion: 0.22
Nodes (8): 弈 (Yì) — AI Agent 系统, 快速开始, 手动启动, 架构, 核心特征, 设计纲领, 项目文档, 项目状态

### Community 68 - "App.vue"
Cohesion: 0.22
Nodes (7): activeTab, charactersStore, chatStore, providersStore, route, router, showSidebar

### Community 69 - "sessionStore.ts"
Cohesion: 0.31
Nodes (6): MessageRow, messageStore, getDb(), SessionRow, sessionStore, router

### Community 70 - "characters.ts"
Cohesion: 0.29
Nodes (6): Character, CharacterConfig, CharacterMemory, deleteCharacter(), ToolBinding, ToolConstraint

### Community 71 - "OutlinePanel.vue"
Cohesion: 0.25
Nodes (4): chatStore, OutlineItem, outlineItems, activePanel

### Community 72 - "AgentSettings.vue"
Cohesion: 0.25
Nodes (7): autoApproveTools, enforcementOptions, gatewayTimeout, maxTurns, restartDrainTimeout, { t }, toolEnforcement

### Community 73 - "SettingsView.vue"
Cohesion: 0.25
Nodes (6): activeTab, allKeys, navTabs, route, router, { t }

### Community 74 - "WorkspaceGroup.vue"
Cohesion: 0.25
Nodes (5): chatStore, emit, props, emit, WorkspaceGroup

### Community 75 - "workspace.ts"
Cohesion: 0.36
Nodes (5): browseDirectory(), BrowseResult, DirEntry, resolvePath(), Props

### Community 76 - "ToolSettings.vue"
Cohesion: 0.33
Nodes (4): builtinTools, store, { t }, useToolsStore

### Community 77 - "markdown-it.d.ts"
Cohesion: 0.29
Nodes (4): markdown-it, MarkdownIt, MarkdownItConstructor, MarkdownItOptions

### Community 78 - "markdown-it.d.ts"
Cohesion: 0.29
Nodes (4): markdown-it, MarkdownIt, MarkdownItConstructor, MarkdownItOptions

### Community 80 - "FilesPanel.vue"
Cohesion: 0.40
Nodes (3): filesStore, FileEntry, useFilesStore

### Community 81 - "index.ts"
Cohesion: 0.50
Nodes (3): hasBOM(), stripBOM(), tool

### Community 82 - "copy-tool-json.js"
Cohesion: 0.50
Nodes (3): dest, __dirname, src

## Knowledge Gaps
- **587 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+582 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `App()` connect `WorkspacePicker.vue` to `SettingsPage.tsx`, `App.tsx`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `apiGet()` connect `apiGet` to `SkillSettings.vue`, `characters.ts`, `EvolutionSettings.vue`, `SessionSettings.vue`, `WorkspacePicker.vue`, `tools.ts`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _587 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `chatStore.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.062004662004662 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.0425531914893617 - nodes in this community are weakly interconnected._
- **Should `SkillSettings.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.06827880512091039 - nodes in this community are weakly interconnected._
- **Should `EventsView.vue` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._