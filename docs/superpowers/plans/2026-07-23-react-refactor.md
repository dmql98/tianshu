# 天枢前端 React 重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将现有 Vue 3 + Vite 前端重构为 React + Vite，保持中国古风设计风格和完整功能

**架构：** React 18 + TypeScript + Vite + React Router + Zustand 状态管理 + Socket.IO 客户端。组件化拆分，复用现有 API 接口定义，保留所有功能模块（聊天、角色、技能、工具、事件、市场、MCP、设置）。

**技术栈：** React 18, TypeScript, Vite, React Router 6, Zustand, Socket.IO Client, Tailwind CSS (可选), CSS Modules

---

## 文件结构

### 新建文件（React 项目）

```
tianshu-web/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── public/
│   └── yi-logo.png
├── src/
│   ├── main.tsx                    # 入口
│   ├── App.tsx                     # 根组件
│   ├── index.css                   # 全局样式
│   ├── api/
│   │   ├── client.ts              # HTTP 客户端 (复用现有)
│   │   ├── sessions.ts            # 会话 API
│   │   ├── characters.ts          # 角色 API
│   │   ├── skills.ts              # 技能 API
│   │   ├── tools.ts               # 工具 API
│   │   ├── events.ts              # 事件 API
│   │   ├── providers.ts           # 模型服务 API
│   │   ├── socket.ts              # Socket.IO 连接
│   │   └── workspace.ts           # 工作区 API
│   ├── stores/
│   │   ├── chatStore.ts           # 聊天状态 (Zustand)
│   │   ├── charactersStore.ts     # 角色状态
│   │   ├── providersStore.ts      # 模型服务状态
│   │   └── uiStore.ts             # UI 状态
│   ├── types/
│   │   └── index.ts               # 类型定义
│   ├── hooks/
│   │   ├── useSocket.ts           # Socket.IO hook
│   │   └── useChat.ts             # 聊天逻辑 hook
│   ├── components/
│   │   ├── Layout/
│   │   │   ├── AppLayout.tsx      # 应用布局
│   │   │   ├── NavRail.tsx        # 左侧导航栏
│   │   │   └── Sidebar.tsx        # 会话列表侧边栏
│   │   ├── Chat/
│   │   │   ├── ChatArea.tsx       # 聊天主区域
│   │   │   ├── ChatInput.tsx      # 输入框
│   │   │   ├── MessageList.tsx    # 消息列表
│   │   │   ├── MessageItem.tsx    # 单条消息
│   │   │   ├── ThinkingBlock.tsx  # 思考块
│   │   │   ├── ToolCall.tsx       # 工具调用
│   │   │   └── ApprovalDialog.tsx # 权限审批弹窗
│   │   ├── Panels/
│   │   │   ├── SidePanel.tsx      # 右侧面板
│   │   │   ├── FilePanel.tsx      # 文件面板
│   │   │   └── SessionList.tsx    # 会话列表
│   │   ├── Roles/
│   │   │   ├── RoleCard.tsx       # 角色卡片
│   │   │   └── RoleDetail.tsx     # 角色详情
│   │   └── Common/
│   │       ├── SearchInput.tsx    # 搜索框
│   │       └── Badge.tsx          # 徽章
│   └── views/
│       ├── ChatView.tsx           # 聊天页
│       ├── RoleView.tsx           # 角色页
│       ├── SkillView.tsx          # 技能页
│       ├── ToolView.tsx           # 工具页
│       ├── EventsView.tsx         # 事件页
│       ├── MarketView.tsx         # 市场页
│       ├── McpView.tsx            # MCP 页
│       ├── SettingsView.tsx       # 设置页
│       └── NotFound.tsx           # 404 页
```

### 修改文件（从 Vue 迁移）

| 原文件 | 新文件 | 变更说明 |
|--------|--------|----------|
| `api/client.ts` | `api/client.ts` | 直接复用 |
| `api/sessions.ts` | `api/sessions.ts` | 移除 Vue 依赖 |
| `stores/chat.ts` | `stores/chatStore.ts` | Pinia → Zustand |
| `router/index.ts` | `src/App.tsx` | Vue Router → React Router |

---

## 任务 1：项目初始化

**文件：**
- 创建：`tianshu-web/package.json`
- 创建：`tianshu-web/vite.config.ts`
- 创建：`tianshu-web/tsconfig.json`
- 创建：`tianshu-web/index.html`
- 创建：`tianshu-web/src/main.tsx`
- 创建：`tianshu-web/src/index.css`

- [ ] **步骤 1：创建 package.json**

```json
{
  "name": "tianshu-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0",
    "zustand": "^5.0.0",
    "socket.io-client": "^4.8.0",
    "markdown-it": "^14.2.0",
    "highlight.js": "^11.11.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/markdown-it": "^14.1.2",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **步骤 2：创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3210',
      '/socket.io': {
        target: 'http://localhost:3210',
        ws: true,
      },
    },
  },
})
```

- [ ] **步骤 3：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **步骤 4：创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>天枢</title>
    <link rel="icon" type="image/png" href="/yi-logo.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **步骤 5：创建 src/main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **步骤 6：创建 src/index.css**

```css
:root {
  --bg-main: #f5f0e8;
  --bg-card: #ede6da;
  --bg-hover: #e0d8cc;
  --bg-input: #faf8f4;
  --border: rgba(180, 160, 130, 0.15);
  --border-light: rgba(180, 160, 130, 0.08);
  --gold: #c8960a;
  --gold-light: #f5d68a;
  --jade: #2a9d5c;
  --cinnabar: #c45c3c;
  --ink-deep: #2c2418;
  --ink-mid: #5c5040;
  --ink-light: #8a7d68;
  --ink-faint: #b8a890;
  --star-changgeng: #c8960a;
  --star-tianxuan: #2563eb;
  --star-wenqu: #059669;
  --star-ziwei: #7c3aed;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
}

body {
  font-family: "霞鹜文楷", "LXGW WenKai", "Kaiti SC", "STKaiti", serif;
  background: var(--bg-main);
  color: var(--ink-deep);
  overflow: hidden;
}

::selection {
  background: var(--gold-light);
  color: var(--ink-deep);
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-thumb {
  background: var(--ink-faint);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--ink-light);
}
```

- [ ] **步骤 7：安装依赖并验证**

```bash
cd tianshu-web
npm install
npm run dev
```

预期：Vite 开发服务器启动成功，访问 http://localhost:3000 显示空白页面

- [ ] **步骤 8：Commit**

```bash
git add tianshu-web
git commit -m "feat: initialize React + Vite project structure"
```

---

## 任务 2：类型定义和 API 层

**文件：**
- 创建：`src/types/index.ts`
- 创建：`src/api/client.ts`
- 创建：`src/api/sessions.ts`
- 创建：`src/api/characters.ts`
- 创建：`src/api/skills.ts`
- 创建：`src/api/tools.ts`
- 创建：`src/api/events.ts`
- 创建：`src/api/providers.ts`
- 创建：`src/api/socket.ts`

- [ ] **步骤 1：创建类型定义 src/types/index.ts**

```typescript
// 会话相关
export interface SessionSummary {
  id: string
  character_id: string
  title: string
  model: string | null
  provider_id: string | null
  workspace: string | null
  workspaces: string | null
  parent_id: string | null
  active_group: string | null
  session_type?: 'chat' | 'event'
  event_id?: string | null
  current_strategy?: 'Plan' | 'Ask' | 'Bypass'
  context_window?: number | null
  created_at: number
  updated_at: number
}

export interface Session extends SessionSummary {
  messages: Message[]
  pinned?: boolean
  thinking?: boolean
  reasoning_effort?: string
  compacted?: boolean
  cacheStats?: { hitTokens: number; missTokens: number; hitRatio: string }
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  attachments?: { name: string; mime: string; dataUrl?: string }[]
  tool_name?: string
  tool_input?: string
  tool_output?: string
  tool_call_id?: string
  tool_status?: 'running' | 'done' | 'success' | 'error'
  is_streaming?: boolean
  reasoning?: string
  reasoning_duration?: number
  timestamp: number
}

// 角色相关
export interface Character {
  id: string
  name: string
  title: string
  desc: string
  icon: string
  color: string
  role: 'main' | 'sub' | 'both'
  groups: string[]
  default_strategy: 'Plan' | 'Ask' | 'Bypass'
  provider: string
  model: string
  max_steps: number
  tools: string[]
  skills: string[]
}

// 技能相关
export interface Skill {
  id: string
  name: string
  description: string
  category: string
  enabled: boolean
}

// 工具相关
export interface Tool {
  id: string
  name: string
  description: string
  type: string
  enabled: boolean
}

// 事件相关
export interface Event {
  id: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  trigger: string
  created_at: number
}

// 模型服务相关
export interface Provider {
  id: string
  name: string
  type: string
  enabled: boolean
  models: string[]
}

// Socket 事件
export interface RunEvent {
  session_id: string
  delta?: string
  reasoning?: string
  tool_name?: string
  tool_input?: string
  tool_output?: string
  tool_call_id?: string
  tool_status?: string
  strategy?: string
  error?: string
  cache?: { hitTokens: number; missTokens: number; hitRatio: string }
}

// 工作区
export interface WorkspaceGroup {
  name: string
  sessions: Session[]
  collapsed: boolean
}
```

- [ ] **步骤 2：创建 API 客户端 src/api/client.ts**

```typescript
const API_BASE = import.meta.env.VITE_API_URL || ''

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
}
```

- [ ] **步骤 3：创建 Sessions API src/api/sessions.ts**

```typescript
import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { SessionSummary } from '@/types'

export const fetchSessions = () => apiGet<SessionSummary[]>('/api/sessions')

export const createSession = (data: Partial<SessionSummary> & { id: string }) =>
  apiPost<SessionSummary>('/api/sessions', data)

export const updateSession = (id: string, data: Partial<SessionSummary>) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, data)

export const renameSession = (id: string, title: string) =>
  apiPut<SessionSummary>(`/api/sessions/${id}`, { title })

export const deleteSession = (id: string) =>
  apiDelete(`/api/sessions/${id}`)

export const fetchSessionMessages = (id: string) =>
  apiGet<{ session: SessionSummary; messages: any[]; total: number }>(`/api/sessions/${id}/messages`)

export const keepMessages = (sessionId: string, count: number) =>
  apiDelete(`/api/sessions/${sessionId}/messages?keep=${count}`)

export const fetchChildSessions = (id: string) =>
  apiGet<SessionSummary[]>(`/api/sessions/${id}/children`)
```

- [ ] **步骤 4：创建 Characters API src/api/characters.ts**

```typescript
import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Character } from '@/types'

export const fetchCharacters = () => apiGet<Character[]>('/api/characters')

export const createCharacter = (data: Partial<Character> & { id: string }) =>
  apiPost<Character>('/api/characters', data)

export const updateCharacter = (id: string, data: Partial<Character>) =>
  apiPut<Character>(`/api/characters/${id}`, data)

export const deleteCharacter = (id: string) =>
  apiDelete(`/api/characters/${id}`)
```

- [ ] **步骤 5：创建其他 API 文件**

```typescript
// src/api/skills.ts
import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Skill } from '@/types'

export const fetchSkills = () => apiGet<Skill[]>('/api/skills')
export const createSkill = (data: Partial<Skill> & { id: string }) => apiPost<Skill>('/api/skills', data)
export const updateSkill = (id: string, data: Partial<Skill>) => apiPut<Skill>(`/api/skills/${id}`, data)
export const deleteSkill = (id: string) => apiDelete(`/api/skills/${id}`)

// src/api/tools.ts
import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Tool } from '@/types'

export const fetchTools = () => apiGet<Tool[]>('/api/tools')
export const createTool = (data: Partial<Tool> & { id: string }) => apiPost<Tool>('/api/tools', data)
export const updateTool = (id: string, data: Partial<Tool>) => apiPut<Tool>(`/api/tools/${id}`, data)
export const deleteTool = (id: string) => apiDelete(`/api/tools/${id}`)

// src/api/events.ts
import { apiGet } from './client'
import type { Event } from '@/types'

export const fetchEvents = () => apiGet<Event[]>('/api/events')

// src/api/providers.ts
import { apiGet, apiPost, apiPut, apiDelete } from './client'
import type { Provider } from '@/types'

export const fetchProviders = () => apiGet<Provider[]>('/api/providers')
export const createProvider = (data: Partial<Provider> & { id: string }) => apiPost<Provider>('/api/providers', data)
export const updateProvider = (id: string, data: Partial<Provider>) => apiPut<Provider>(`/api/providers/${id}`, data)
export const deleteProvider = (id: string) => apiDelete(`/api/providers/${id}`)
```

- [ ] **步骤 6：创建 Socket.IO 连接 src/api/socket.ts**

```typescript
import { io, Socket } from 'socket.io-client'
import type { RunEvent } from '@/types'

let socket: Socket | null = null

export function connectSocket(): Socket {
  if (socket?.connected) return socket
  
  socket = io(window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    console.log('[Socket] connected')
  })

  socket.on('disconnect', () => {
    console.log('[Socket] disconnected')
  })

  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export type { RunEvent }
```

- [ ] **步骤 7：验证 API 层**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 8：Commit**

```bash
git add src/types src/api
git commit -m "feat: add TypeScript types and API layer"
```

---

## 任务 3：状态管理 (Zustand Stores)

**文件：**
- 创建：`src/stores/chatStore.ts`
- 创建：`src/stores/charactersStore.ts`
- 创建：`src/stores/providersStore.ts`
- 创建：`src/stores/uiStore.ts`

- [ ] **步骤 1：创建聊天 Store src/stores/chatStore.ts**

```typescript
import { create } from 'zustand'
import type { Session, Message, WorkspaceGroup } from '@/types'
import * as sessionsApi from '@/api/sessions'
import { connectSocket, getSocket, type RunEvent } from '@/api/socket'

const PERSIST_KEY = 'tianshu-chat-defaults'
const DEFAULT_WORKSPACE = 'C:\\.Tianshu'

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function loadPersistedDefaults() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { defaultWorkspace: DEFAULT_WORKSPACE }
    return JSON.parse(raw)
  } catch {
    return { defaultWorkspace: DEFAULT_WORKSPACE }
  }
}

function savePersistedDefaults(data: Record<string, string | undefined>) {
  const existing = loadPersistedDefaults()
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...existing, ...data }))
}

interface ChatState {
  sessions: Session[]
  activeSessionId: string | null
  activeSession: Session | null
  isStreaming: boolean
  pendingApproval: { tool_call_id: string; tool_name: string; description: string } | null
  collapsedWorkspaces: Set<string>
  workspaceGroups: WorkspaceGroup[]
  tokenUsage: { input: number; output: number; total: number }
  contextUsage: { pct: number; used: number; total: number; show: boolean }
  
  loadSessions: () => Promise<void>
  createSession: (opts?: any) => Promise<Session>
  switchSession: (id: string) => Promise<void>
  sendMessage: (input: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  setStrategy: (strategy: 'Plan' | 'Ask' | 'Bypass') => void
  respondApproval: (choice: 'once' | 'always' | 'reject') => void
  abortRun: () => void
  addWorkspace: (path: string) => void
  removeWorkspace: (path: string) => void
  toggleWorkspaceCollapse: (workspace: string) => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeSession: null,
  isStreaming: false,
  pendingApproval: null,
  collapsedWorkspaces: new Set(),
  workspaceGroups: [],
  tokenUsage: { input: 0, output: 0, total: 0 },
  contextUsage: { pct: 0, used: 0, total: 200000, show: false },

  loadSessions: async () => {
    const list = await sessionsApi.fetchSessions()
    const sessions = list.map(s => ({
      ...s,
      messages: [] as Message[],
    }))
    set({ sessions })
  },

  createSession: async (opts = {}) => {
    const defs = loadPersistedDefaults()
    const session: Session = {
      id: uid(),
      character_id: opts.character_id || 'general',
      title: opts.title || '',
      model: opts.model || defs.model,
      provider_id: opts.provider_id || defs.provider_id,
      workspace: opts.workspace || defs.defaultWorkspace,
      messages: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    
    set(state => ({ sessions: [session, ...state.sessions] }))
    
    try {
      await sessionsApi.createSession({
        id: session.id,
        character_id: session.character_id,
        title: session.title,
      })
    } catch {
      // will be created on first message if needed
    }
    
    return session
  },

  switchSession: async (id: string) => {
    set({ activeSessionId: id })
    const state = get()
    const session = state.sessions.find(s => s.id === id)
    
    if (session && session.messages.length === 0) {
      try {
        const data = await sessionsApi.fetchSessionMessages(id)
        const messages = data.messages.map(m => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
          tool_name: m.tool_name || undefined,
          tool_input: m.tool_input || undefined,
          tool_output: m.tool_output || undefined,
          tool_status: m.tool_status || undefined,
          timestamp: m.created_at,
        }))
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === id ? { ...s, messages } : s
          ),
        }))
      } catch {
        // new session
      }
    }
  },

  sendMessage: async (input: string) => {
    const state = get()
    let session = state.activeSession
      ? state.sessions.find(s => s.id === state.activeSessionId)
      : null

    if (!session) {
      session = await get().createSession()
      set({ activeSessionId: session.id })
    }

    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }

    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === session!.id
          ? { ...s, messages: [...s.messages, userMsg] }
          : s
      ),
      isStreaming: true,
    }))

    const socket = connectSocket()
    socket.emit('chat-run', {
      session_id: session.id,
      character_id: session.character_id,
      input,
      model: session.model,
      provider_id: session.provider_id,
      workspace: session.workspace,
    })

    // Socket event handlers would be registered here
    // Similar to the Vue store implementation
  },

  renameSession: async (id: string, title: string) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, title } : s
      ),
    }))
    await sessionsApi.renameSession(id, title)
  },

  deleteSession: async (id: string) => {
    set(state => ({
      sessions: state.sessions.filter(s => s.id !== id && s.parent_id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    }))
    await sessionsApi.deleteSession(id)
  },

  setStrategy: (strategy) => {
    const socket = getSocket()
    const state = get()
    if (socket?.connected && state.activeSessionId) {
      socket.emit('strategy.set', {
        session_id: state.activeSessionId,
        strategy,
      })
    }
  },

  respondApproval: (choice) => {
    const socket = getSocket()
    const state = get()
    if (socket?.connected && state.pendingApproval && state.activeSessionId) {
      socket.emit('approval.respond', {
        session_id: state.activeSessionId,
        tool_call_id: state.pendingApproval.tool_call_id,
        choice,
      })
    }
    set({ pendingApproval: null })
  },

  abortRun: () => {
    const socket = getSocket()
    const state = get()
    if (socket?.connected && state.activeSessionId) {
      socket.emit('abort', { session_id: state.activeSessionId })
    }
  },

  addWorkspace: (path) => {
    const state = get()
    const session = state.sessions.find(s => s.id === state.activeSessionId)
    if (!session) return
    
    const workspaces = session.workspaces || [session.workspace || path]
    if (!workspaces.includes(path)) {
      workspaces.push(path)
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === session.id ? { ...s, workspaces } : s
        ),
      }))
      sessionsApi.updateSession(session.id, {
        workspaces: JSON.stringify(workspaces),
      }).catch(() => {})
    }
  },

  removeWorkspace: (path) => {
    const state = get()
    const session = state.sessions.find(s => s.id === state.activeSessionId)
    if (!session || !session.workspaces) return
    if (path === session.workspace) return // Default workspace cannot be deleted
    
    const workspaces = session.workspaces.filter(w => w !== path)
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === session.id ? { ...s, workspaces } : s
      ),
    }))
    sessionsApi.updateSession(session.id, {
      workspaces: workspaces.length > 0 ? JSON.stringify(workspaces) : null,
    }).catch(() => {})
  },

  toggleWorkspaceCollapse: (workspace) => {
    set(state => {
      const collapsed = new Set(state.collapsedWorkspaces)
      if (collapsed.has(workspace)) {
        collapsed.delete(workspace)
      } else {
        collapsed.add(workspace)
      }
      return { collapsedWorkspaces: collapsed }
    })
  },
}))
```

- [ ] **步骤 2：创建 Characters Store src/stores/charactersStore.ts**

```typescript
import { create } from 'zustand'
import type { Character } from '@/types'
import * as charactersApi from '@/api/characters'

interface CharactersState {
  characters: Character[]
  loading: boolean
  load: () => Promise<void>
  getById: (id: string) => Character | undefined
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  characters: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const characters = await charactersApi.fetchCharacters()
      set({ characters, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  getById: (id) => {
    return get().characters.find(c => c.id === id)
  },
}))
```

- [ ] **步骤 3：创建 Providers Store src/stores/providersStore.ts**

```typescript
import { create } from 'zustand'
import type { Provider } from '@/types'
import * as providersApi from '@/api/providers'

interface ProvidersState {
  providers: Provider[]
  loading: boolean
  load: () => Promise<void>
}

export const useProvidersStore = create<ProvidersState>((set) => ({
  providers: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const providers = await providersApi.fetchProviders()
      set({ providers, loading: false })
    } catch {
      set({ loading: false })
    }
  },
}))
```

- [ ] **步骤 4：创建 UI Store src/stores/uiStore.ts**

```typescript
import { create } from 'zustand'

interface UIState {
  sidebarOpen: boolean
  rightPanelOpen: boolean
  filePanelOpen: void
  activeTab: string
  
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleFilePanel: () => void
  setActiveTab: (tab: string) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  rightPanelOpen: true,
  filePanelOpen: false,
  activeTab: 'chat',

  toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
  toggleRightPanel: () => set(state => ({ rightPanelOpen: !state.rightPanelOpen })),
  toggleFilePanel: () => set(state => ({ filePanelOpen: !state.filePanelOpen })),
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
```

- [ ] **步骤 5：验证 Store 层**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 6：Commit**

```bash
git add src/stores
git commit -m "feat: add Zustand stores for state management"
```

---

## 任务 4：布局组件

**文件：**
- 创建：`src/components/Layout/AppLayout.tsx`
- 创建：`src/components/Layout/NavRail.tsx`
- 创建：`src/components/Layout/Sidebar.tsx`

- [ ] **步骤 1：创建 AppLayout src/components/Layout/AppLayout.tsx**

```tsx
import { Outlet } from 'react-router-dom'
import NavRail from './NavRail'
import Sidebar from './Sidebar'
import { useUIStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'

export default function AppLayout() {
  const { activeTab, sidebarOpen } = useUIStore()
  const evolutionNotification = useChatStore(s => s.evolutionNotification)

  return (
    <div className="app-layout">
      <NavRail />
      {activeTab === 'chat' && sidebarOpen && <Sidebar />}
      <Outlet />
      {evolutionNotification && (
        <div className="evolution-toast">
          <span className="toast-icon">🧬</span>
          <span>已创建进化事件</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **步骤 2：创建 NavRail src/components/Layout/NavRail.tsx**

```tsx
import { useNavigate, useLocation } from 'react-router-dom'
import { useUIStore } from '@/stores/uiStore'

const navItems = [
  { path: '/c', icon: '💬', label: '会话', tab: 'chat' },
  { path: '/events', icon: '⚡', label: '事件', tab: 'events' },
  { path: '/role', icon: '🎭', label: '角色', tab: 'role' },
  { path: '/skill', icon: '🛠️', label: '技能', tab: 'skill' },
  { path: '/tool', icon: '🔧', label: '工具', tab: 'tool' },
  { path: '/mcp', icon: '🔗', label: 'MCP', tab: 'mcp' },
  { path: '/market', icon: '🏪', label: '市场', tab: 'market' },
]

export default function NavRail() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setActiveTab } = useUIStore()

  const activeTab = location.pathname.startsWith('/c') ? 'chat'
    : location.pathname === '/events' ? 'events'
    : location.pathname === '/role' ? 'role'
    : location.pathname === '/skill' ? 'skill'
    : location.pathname === '/tool' ? 'tool'
    : location.pathname === '/mcp' ? 'mcp'
    : location.pathname === '/market' ? 'market'
    : location.pathname.startsWith('/settings') ? 'settings'
    : 'chat'

  const handleNav = (path: string, tab: string) => {
    setActiveTab(tab)
    navigate(path)
  }

  return (
    <nav className="nav-rail">
      <div className="nav-logo" title="天枢">天</div>
      {navItems.map(item => (
        <button
          key={item.tab}
          className={`nav-item ${activeTab === item.tab ? 'active' : ''}`}
          onClick={() => handleNav(item.path, item.tab)}
          title={item.label}
        >
          <span className="nav-icon">{item.icon}</span>
          <span className="nav-label">{item.label}</span>
        </button>
      ))}
      <div className="nav-divider" />
      <div className="nav-spacer" />
      <button
        className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => handleNav('/settings', 'settings')}
        title="设置"
      >
        <span className="nav-icon">⚙️</span>
        <span className="nav-label">设置</span>
      </button>
    </nav>
  )
}
```

- [ ] **步骤 3：创建 Sidebar src/components/Layout/Sidebar.tsx**

```tsx
import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useNavigate } from 'react-router-dom'

export default function Sidebar() {
  const navigate = useNavigate()
  const { sessions, activeSessionId, switchSession, createSession, workspaceGroups } = useChatStore()
  const [search, setSearch] = useState('')

  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase())
  )

  const handleNewSession = async () => {
    const session = await createSession()
    navigate(`/c/${session.id}`)
  }

  const handleSelectSession = async (id: string) => {
    await switchSession(id)
    navigate(`/c/${id}`)
  }

  return (
    <aside className="ctx-panel">
      <div className="ctx-header">
        <span className="ctx-title">会话</span>
      </div>
      <div className="ctx-search">
        <input
          placeholder="搜索会话..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <button className="add-btn" onClick={handleNewSession}>
        + 新建会话
      </button>
      <div className="ctx-body">
        {workspaceGroups.map(group => (
          <div key={group.name} className="project-item">
            <div className="project-header" onClick={() => useChatStore.getState().toggleWorkspaceCollapse(group.name)}>
              <span className="project-icon">📁</span>
              <span className="project-name">{group.name}</span>
              <span className={`project-arrow ${!group.collapsed ? 'open' : ''}`}>▶</span>
            </div>
            {!group.collapsed && (
              <div className="project-children">
                {group.sessions.map(session => (
                  <div
                    key={session.id}
                    className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                    onClick={() => handleSelectSession(session.id)}
                  >
                    <div className="session-dot chat" />
                    <div className="session-info">
                      <div className="session-title">{session.title || '新会话'}</div>
                      <div className="session-meta">
                        <span>{new Date(session.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
```

- [ ] **步骤 4：添加布局样式 src/index.css**

在 `src/index.css` 末尾添加：

```css
.app-layout {
  display: flex;
  height: 100vh;
}

.nav-rail {
  width: 60px;
  min-width: 60px;
  z-index: 10;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 4px;
}

.nav-logo {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  margin-bottom: 12px;
  background: linear-gradient(135deg, var(--gold), #a07808);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  cursor: pointer;
  transition: transform 0.2s;
}

.nav-logo:hover {
  transform: scale(1.05);
}

.nav-item {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--ink-light);
  font-size: 18px;
  transition: all 0.15s;
}

.nav-item:hover {
  background: var(--bg-hover);
  color: var(--ink-mid);
}

.nav-item.active {
  background: rgba(200, 150, 10, 0.1);
  color: var(--gold);
}

.nav-label {
  font-size: 9px;
  line-height: 1;
}

.nav-divider {
  width: 28px;
  height: 1px;
  background: var(--border);
  margin: 6px 0;
}

.nav-spacer {
  flex: 1;
}

.ctx-panel {
  width: 220px;
  min-width: 220px;
  z-index: 9;
  background: var(--bg-card);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ctx-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ctx-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-mid);
}

.ctx-search {
  padding: 8px 10px 6px;
}

.ctx-search input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--ink-deep);
  font-size: 12px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}

.ctx-search input:focus {
  border-color: var(--gold);
}

.ctx-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--ink-mid);
  cursor: pointer;
  font-size: 12px;
  margin: 4px 10px 8px;
  transition: all 0.15s;
}

.add-btn:hover {
  border-color: var(--gold);
  color: var(--gold);
  background: rgba(200, 150, 10, 0.04);
}

.project-item {
  margin-bottom: 4px;
}

.project-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-mid);
}

.project-header:hover {
  background: var(--bg-hover);
}

.project-icon {
  font-size: 14px;
  opacity: 0.7;
}

.project-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-arrow {
  font-size: 9px;
  color: var(--ink-faint);
  transition: transform 0.2s;
  opacity: 0.5;
}

.project-arrow.open {
  transform: rotate(90deg);
  opacity: 1;
}

.project-children {
  padding-left: 12px;
  margin-top: 2px;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: 2px;
  position: relative;
}

.session-item:hover {
  background: var(--bg-hover);
}

.session-item.active {
  background: rgba(200, 150, 10, 0.06);
}

.session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--gold);
  border-radius: 1px;
}

.session-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  opacity: 0.8;
}

.session-item.active .session-dot {
  opacity: 1;
}

.session-dot.chat {
  background: var(--jade);
}

.session-info {
  flex: 1;
  min-width: 0;
}

.session-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-mid);
  font-weight: 400;
}

.session-item.active .session-title {
  color: var(--ink-deep);
  font-weight: 500;
}

.session-meta {
  font-size: 10px;
  color: var(--ink-light);
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
```

- [ ] **步骤 5：验证布局组件**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 6：Commit**

```bash
git add src/components/Layout src/index.css
git commit -m "feat: add layout components (NavRail, Sidebar)"
```

---

## 任务 5：聊天组件

**文件：**
- 创建：`src/views/ChatView.tsx`
- 创建：`src/components/Chat/ChatArea.tsx`
- 创建：`src/components/Chat/ChatInput.tsx`
- 创建：`src/components/Chat/MessageList.tsx`
- 创建：`src/components/Chat/MessageItem.tsx`
- 创建：`src/components/Chat/ThinkingBlock.tsx`
- 创建：`src/components/Chat/ToolCall.tsx`
- 创建：`src/components/Chat/ApprovalDialog.tsx`

- [ ] **步骤 1：创建 ChatView src/views/ChatView.tsx**

```tsx
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useChatStore } from '@/stores/chatStore'
import ChatArea from '@/components/Chat/ChatArea'
import SidePanel from '@/components/Panels/SidePanel'

export default function ChatView() {
  const { id } = useParams<{ id: string }>()
  const { switchSession, loadSessions, sessions } = useChatStore()

  useEffect(() => {
    if (sessions.length === 0) {
      loadSessions()
    }
  }, [])

  useEffect(() => {
    if (id) {
      switchSession(id)
    }
  }, [id, switchSession])

  return (
    <div className="chat-view">
      <ChatArea />
      <SidePanel />
    </div>
  )
}
```

- [ ] **步骤 2：创建 ChatArea src/components/Chat/ChatArea.tsx**

```tsx
import { useChatStore } from '@/stores/chatStore'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import ApprovalDialog from './ApprovalDialog'

export default function ChatArea() {
  const { activeSession, isStreaming, pendingApproval } = useChatStore()
  const session = activeSession

  return (
    <div className="main">
      <div className="input-top-bar">
        <span className="session-name">{session?.title || '新会话'}</span>
        <div style={{ flex: 1 }} />
      </div>
      <MessageList />
      <ChatInput />
      {pendingApproval && <ApprovalDialog />}
    </div>
  )
}
```

- [ ] **步骤 3：创建 MessageList src/components/Chat/MessageList.tsx**

```tsx
import { useEffect, useRef } from 'react'
import { useChatStore } from '@/stores/chatStore'
import MessageItem from './MessageItem'

export default function MessageList() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { activeSession } = useChatStore()
  const messages = activeSession?.messages || []

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="chat-scroll" ref={scrollRef}>
      {messages.map(msg => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </div>
  )
}
```

- [ ] **步骤 4：创建 MessageItem src/components/Chat/MessageItem.tsx**

```tsx
import type { Message } from '@/types'
import ThinkingBlock from './ThinkingBlock'
import ToolCall from './ToolCall'

interface Props {
  message: Message
}

export default function MessageItem({ message }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (isTool) {
    return <ToolCall message={message} />
  }

  return (
    <div className={`msg-group ${isUser ? 'user' : 'star'}`}>
      {!isUser && message.reasoning && (
        <ThinkingBlock
          content={message.reasoning}
          duration={message.reasoning_duration}
        />
      )}
      <div className="msg-bubble">
        {message.content.split('\n').map((line, i) => (
          <span key={i}>
            {line}
            {i < message.content.split('\n').length - 1 && <br />}
          </span>
        ))}
      </div>
      <div className="msg-time">{time}</div>
    </div>
  )
}
```

- [ ] **步骤 5：创建 ThinkingBlock src/components/Chat/ThinkingBlock.tsx**

```tsx
import { useState } from 'react'

interface Props {
  content: string
  duration?: number
}

export default function ThinkingBlock({ content, duration }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="thinking-block" onClick={() => setExpanded(!expanded)}>
      <div className="th-header">
        ◈ 思考中 {duration ? `· ${(duration / 1000).toFixed(1)}s` : ''}
      </div>
      {expanded && <div className="th-content">{content}</div>}
    </div>
  )
}
```

- [ ] **步骤 6：创建 ToolCall src/components/Chat/ToolCall.tsx**

```tsx
import { useState } from 'react'
import type { Message } from '@/types'

interface Props {
  message: Message
}

const icons: Record<string, string> = {
  read: '📄',
  write: '✏️',
  edit: '🔧',
  bash: '⚙️',
  grep: '🔍',
  glob: '📂',
}

export default function ToolCall({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const status = message.tool_status || 'running'
  const icon = icons[message.tool_name || ''] || '⚙️'

  return (
    <div className="msg-group star">
      <div className="tool-tag-row">
        <span
          className={`tool-tag ${status}`}
          onClick={() => setExpanded(!expanded)}
        >
          <span>{icon}</span>
          {message.tool_name} · {status === 'success' ? '✓ 成功' : status === 'error' ? '✗ 失败' : '执行中...'}
          <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>▶</span>
        </span>
        <div className="tool-detail-text">{message.tool_input}</div>
      </div>
      {expanded && message.tool_output && (
        <div className="tool-detail">{message.tool_output}</div>
      )}
    </div>
  )
}
```

- [ ] **步骤 7：创建 ChatInput src/components/Chat/ChatInput.tsx**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chatStore'

export default function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { sendMessage, isStreaming, abortRun } = useChatStore()

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const handleSend = () => {
    if (!input.trim() || isStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="input-area">
      <div className="input-main">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            rows={1}
            placeholder="输入消息..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="input-actions">
            {isStreaming ? (
              <button className="send-btn stop" onClick={abortRun} title="停止">
                ⏹
              </button>
            ) : (
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                title="发送"
              >
                ⬆
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **步骤 8：创建 ApprovalDialog src/components/Chat/ApprovalDialog.tsx**

```tsx
import { useChatStore } from '@/stores/chatStore'

export default function ApprovalDialog() {
  const { pendingApproval, respondApproval } = useChatStore()

  if (!pendingApproval) return null

  return (
    <div className="approval-overlay">
      <div className="approval-dialog">
        <div className="approval-title">⚠️ 工作区权限申请</div>
        <div className="approval-desc">
          工具 <strong>{pendingApproval.tool_name}</strong> 需要访问工作区外的路径：
        </div>
        <div className="approval-path">{pendingApproval.description}</div>
        <div className="approval-actions">
          <button className="approval-btn reject" onClick={() => respondApproval('reject')}>
            拒绝
          </button>
          <button className="approval-btn once" onClick={() => respondApproval('once')}>
            仅本次
          </button>
          <button className="approval-btn always" onClick={() => respondApproval('always')}>
            始终允许
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **步骤 9：添加聊天样式 src/index.css**

在 `src/index.css` 末尾添加：

```css
.chat-view {
  flex: 1;
  display: flex;
  min-width: 0;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
  z-index: 2;
  overflow: hidden;
}

.input-top-bar {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-card);
}

.session-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-mid);
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 75%;
}

.msg-group.user {
  align-self: flex-end;
  align-items: flex-end;
}

.msg-group.star {
  align-self: flex-start;
  align-items: flex-start;
}

.msg-bubble {
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.65;
  position: relative;
  word-break: break-word;
}

.msg-group.star .msg-bubble {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
  color: var(--ink-deep);
}

.msg-group.user .msg-bubble {
  background: var(--gold);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.msg-time {
  font-size: 10px;
  color: var(--ink-faint);
  padding: 0 4px;
}

.thinking-block {
  margin-bottom: 8px;
  padding: 8px 12px;
  background: rgba(37, 99, 235, 0.04);
  border: 1px solid rgba(37, 99, 235, 0.12);
  border-left: 3px solid var(--star-tianxuan);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ink-mid);
  cursor: pointer;
}

.th-header {
  font-size: 10px;
  color: var(--star-tianxuan);
  margin-bottom: 4px;
}

.tool-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  margin-top: 6px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border);
}

.tool-tag.success {
  background: rgba(42, 157, 92, 0.06);
  border-color: rgba(42, 157, 92, 0.2);
  color: var(--jade);
}

.tool-tag.error {
  background: rgba(196, 92, 60, 0.06);
  border-color: rgba(196, 92, 60, 0.2);
  color: var(--cinnabar);
}

.tool-tag.running {
  background: rgba(37, 99, 235, 0.06);
  border-color: rgba(37, 99, 235, 0.2);
  color: var(--star-tianxuan);
}

.expand-icon {
  margin-left: 4px;
  font-size: 10px;
  transition: transform 0.2s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.tool-detail {
  margin-top: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--ink-light);
  font-family: monospace;
  max-height: 120px;
  overflow-y: auto;
}

.input-area {
  border-top: 1px solid var(--border-light);
  background: var(--bg-card);
}

.input-main {
  display: flex;
  gap: 12px;
  align-items: stretch;
  padding: 12px 28px 14px;
}

.input-box {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-input);
  overflow: visible;
  position: relative;
  transition: border-color 0.2s, box-shadow 0.2s;
  min-height: 80px;
}

.input-box:focus-within {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(200, 150, 10, 0.08);
}

.chat-textarea {
  flex: 1;
  padding: 10px 14px;
  padding-bottom: 36px;
  border: none;
  background: transparent;
  color: var(--ink-deep);
  font-family: inherit;
  font-size: 14px;
  resize: none;
  outline: none;
  min-height: 24px;
  max-height: 120px;
  line-height: 1.5;
}

.chat-textarea::placeholder {
  color: var(--ink-faint);
}

.input-actions {
  position: absolute;
  bottom: 8px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.send-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: var(--gold);
  color: #fff;
  font-size: 15px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-btn:hover:not(:disabled) {
  background: #b08508;
  box-shadow: 0 0 16px rgba(200, 150, 10, 0.3);
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn.stop {
  background: var(--cinnabar);
}

.approval-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(44, 36, 24, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.approval-dialog {
  width: 400px;
  padding: 20px;
  border-radius: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 20px 60px rgba(44, 36, 24, 0.2);
}

.approval-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--ink-deep);
}

.approval-desc {
  font-size: 13px;
  color: var(--ink-mid);
  margin-bottom: 12px;
  line-height: 1.6;
}

.approval-path {
  padding: 8px 12px;
  border-radius: 8px;
  margin-bottom: 14px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  font-family: monospace;
  font-size: 12px;
  color: var(--gold);
  word-break: break-all;
}

.approval-actions {
  display: flex;
  gap: 8px;
}

.approval-btn {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  border: none;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.approval-btn.reject {
  background: transparent;
  color: var(--cinnabar);
  border: 1px solid var(--cinnabar);
}

.approval-btn.once {
  background: var(--bg-hover);
  color: var(--ink-deep);
}

.approval-btn.always {
  background: var(--gold);
  color: #fff;
}
```

- [ ] **步骤 10：验证聊天组件**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 11：Commit**

```bash
git add src/views/ChatView.tsx src/components/Chat src/index.css
git commit -m "feat: add chat components (ChatArea, MessageList, ChatInput)"
```

---

## 任务 6：右侧面板组件

**文件：**
- 创建：`src/components/Panels/SidePanel.tsx`
- 创建：`src/components/Panels/FilePanel.tsx`

- [ ] **步骤 1：创建 SidePanel src/components/Panels/SidePanel.tsx**

```tsx
import { useChatStore } from '@/stores/chatStore'
import { useCharactersStore } from '@/stores/charactersStore'
import { useUIStore } from '@/stores/uiStore'

export default function SidePanel() {
  const { activeSession, tokenUsage, contextUsage } = useChatStore()
  const { getById } = useCharactersStore()
  const { rightPanelOpen, toggleRightPanel } = useUIStore()

  if (!rightPanelOpen) return null

  const character = activeSession ? getById(activeSession.character_id) : null

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <span className="rp-title">星官详情</span>
        <span className="rp-close" onClick={toggleRightPanel}>✕</span>
      </div>
      <div className="rp-body">
        {character && (
          <>
            <div className="rp-art-card">
              <div className="rp-art" style={{
                background: `linear-gradient(135deg, ${character.color}15, ${character.color}08)`
              }}>
                {character.icon}
              </div>
              <div className="rp-art-info">
                <div className="rp-art-name">{character.name}</div>
                <div className="rp-art-title">{character.title}</div>
                <div className="rp-art-desc">{character.desc}</div>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">运行配置</div>
              <div className="rp-row">
                <span className="label">模型</span>
                <span className="value">{character.model}</span>
              </div>
              <div className="rp-row">
                <span className="label">策略</span>
                <span className="value">{character.default_strategy}</span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">运行状态</div>
              <div className="rp-row">
                <span className="label">上下文</span>
                <span className="value">{contextUsage.used} / {contextUsage.total}</span>
              </div>
              <div className="rp-meter">
                <div className="fill" style={{ width: `${contextUsage.pct}%` }} />
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">会话统计</div>
              <div className="rp-stats">
                <div className="rp-stat">
                  <div className="rp-stat-value">{tokenUsage.total}</div>
                  <div className="rp-stat-label">Tokens</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **步骤 2：创建 FilePanel src/components/Panels/FilePanel.tsx**

```tsx
import { useUIStore } from '@/stores/uiStore'

export default function FilePanel() {
  const { filePanelOpen, toggleFilePanel } = useUIStore()

  if (!filePanelOpen) return null

  return (
    <aside className="file-panel">
      <div className="fp-header">
        <span className="fp-title">文件</span>
        <span className="fp-close" onClick={toggleFilePanel}>✕</span>
      </div>
      <div className="fp-body">
        <div className="fp-section">
          <div className="fp-section-title">附件</div>
          <div className="fp-files" />
        </div>
        <div className="fp-section">
          <div className="fp-section-title">输出文件</div>
          <div className="fp-files" />
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **步骤 3：添加面板样式 src/index.css**

在 `src/index.css` 末尾添加：

```css
.right-panel {
  width: 240px;
  min-width: 240px;
  z-index: 9;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.file-panel {
  width: 240px;
  min-width: 240px;
  z-index: 9;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.rp-header,
.fp-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rp-title,
.fp-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-mid);
}

.rp-close,
.fp-close {
  cursor: pointer;
  color: var(--ink-faint);
  font-size: 14px;
}

.rp-close:hover,
.fp-close:hover {
  color: var(--ink-deep);
}

.rp-body,
.fp-body {
  flex: 1;
  overflow-y: auto;
}

.rp-art-card {
  position: relative;
  overflow: hidden;
}

.rp-art {
  width: 100%;
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 64px;
}

.rp-art-info {
  padding: 12px 14px;
}

.rp-art-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink-deep);
  margin-bottom: 2px;
}

.rp-art-title {
  font-size: 12px;
  color: var(--ink-light);
  margin-bottom: 4px;
}

.rp-art-desc {
  font-size: 11px;
  color: var(--ink-mid);
  line-height: 1.5;
}

.rp-section {
  padding: 12px 14px;
  margin-bottom: 0;
  border-top: 1px solid var(--border-light);
}

.rp-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-light);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

.rp-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 12px;
}

.rp-row .label {
  color: var(--ink-light);
}

.rp-row .value {
  color: var(--ink-mid);
  font-weight: 500;
}

.rp-meter {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-hover);
  overflow: hidden;
  margin-top: 4px;
}

.rp-meter .fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--jade), var(--gold));
}

.rp-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.rp-stat {
  padding: 8px;
  border-radius: 6px;
  text-align: center;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
}

.rp-stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink-deep);
}

.rp-stat-label {
  font-size: 10px;
  color: var(--ink-light);
  margin-top: 2px;
}

.fp-section {
  margin-bottom: 12px;
}

.fp-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-light);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}
```

- [ ] **步骤 4：验证面板组件**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 5：Commit**

```bash
git add src/components/Panels src/index.css
git commit -m "feat: add side panel components (SidePanel, FilePanel)"
```

---

## 任务 7：其他页面视图

**文件：**
- 创建：`src/views/RoleView.tsx`
- 创建：`src/views/SkillView.tsx`
- 创建：`src/views/ToolView.tsx`
- 创建：`src/views/EventsView.tsx`
- 创建：`src/views/MarketView.tsx`
- 创建：`src/views/McpView.tsx`
- 创建：`src/views/SettingsView.tsx`
- 创建：`src/views/NotFound.tsx`

- [ ] **步骤 1：创建 RoleView src/views/RoleView.tsx**

```tsx
import { useEffect, useState } from 'react'
import { useCharactersStore } from '@/stores/charactersStore'
import type { Character } from '@/types'

export default function RoleView() {
  const { characters, load, loading } = useCharactersStore()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (characters.length === 0) {
      load()
    }
  }, [])

  const filtered = characters.filter(c =>
    c.name.includes(search) || c.title.includes(search)
  )

  const grouped = filtered.reduce((acc, char) => {
    const group = char.groups?.[0] || '默认'
    if (!acc[group]) acc[group] = []
    acc[group].push(char)
    return acc
  }, {} as Record<string, Character[]>)

  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">角色管理</span>
        <div className="header-actions">
          <input
            className="search-input"
            placeholder="搜索角色..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn primary">+ 新建角色</button>
        </div>
      </div>
      <div className="content">
        {loading ? (
          <div className="empty-state">加载中...</div>
        ) : (
          Object.entries(grouped).map(([group, chars]) => (
            <div key={group}>
              <div className="group-title">{group}</div>
              <div className="star-grid">
                {chars.map(char => (
                  <div key={char.id} className="star-card">
                    <div className="star-art" style={{
                      background: `linear-gradient(135deg, ${char.color}15, ${char.color}08)`
                    }}>
                      {char.icon}
                    </div>
                    <div className="star-info">
                      <div className="star-name">{char.name}</div>
                      <div className="star-title">{char.title}</div>
                      <div className="star-desc">{char.desc}</div>
                      <div className="star-tags">
                        <span className="star-tag jade">已启用</span>
                        <span className="star-tag">{char.model}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **步骤 2：创建其他页面视图**

```tsx
// src/views/SkillView.tsx
export default function SkillView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">技能管理</span>
      </div>
      <div className="content">
        <div className="empty-state">技能管理功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/ToolView.tsx
export default function ToolView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">工具管理</span>
      </div>
      <div className="content">
        <div className="empty-state">工具管理功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/EventsView.tsx
export default function EventsView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">事件中心</span>
      </div>
      <div className="content">
        <div className="empty-state">事件中心功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/MarketView.tsx
export default function MarketView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">市场</span>
      </div>
      <div className="content">
        <div className="empty-state">市场功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/McpView.tsx
export default function McpView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">MCP 管理</span>
      </div>
      <div className="content">
        <div className="empty-state">MCP 管理功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/SettingsView.tsx
export default function SettingsView() {
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">设置</span>
      </div>
      <div className="content">
        <div className="empty-state">设置功能开发中...</div>
      </div>
    </div>
  )
}

// src/views/NotFound.tsx
export default function NotFound() {
  return (
    <div className="main">
      <div className="empty-state">
        <div className="empty-title">404</div>
        <div className="empty-hint">页面不存在</div>
      </div>
    </div>
  )
}
```

- [ ] **步骤 3：添加通用页面样式 src/index.css**

在 `src/index.css` 末尾添加：

```css
.page-header {
  padding: 16px 28px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-input {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--ink-deep);
  font-size: 12px;
  outline: none;
  font-family: inherit;
  width: 180px;
}

.search-input:focus {
  border-color: var(--gold);
}

.btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--ink-mid);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}

.btn:hover {
  border-color: var(--gold);
  color: var(--gold);
}

.btn.primary {
  background: var(--gold);
  color: #fff;
  border-color: var(--gold);
}

.btn.primary:hover {
  background: #b08508;
  color: #fff;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-light);
  margin: 16px 0 8px;
  letter-spacing: 0.5px;
}

.group-title:first-child {
  margin-top: 0;
}

.star-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  margin-bottom: 8px;
}

.star-card {
  border-radius: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
}

.star-card:hover {
  border-color: var(--gold);
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(200, 150, 10, 0.1);
}

.star-art {
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 56px;
  position: relative;
  overflow: hidden;
}

.star-info {
  padding: 14px;
}

.star-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 2px;
}

.star-title {
  font-size: 11px;
  color: var(--ink-light);
  margin-bottom: 6px;
}

.star-desc {
  font-size: 12px;
  color: var(--ink-mid);
  line-height: 1.5;
  margin-bottom: 10px;
}

.star-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.star-tag {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--bg-hover);
  color: var(--ink-light);
}

.star-tag.jade {
  background: rgba(42, 157, 92, 0.1);
  color: var(--jade);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 40px;
}

.empty-title {
  font-size: 16px;
  color: var(--ink-mid);
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: var(--ink-faint);
}

.evolution-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: #1976d2;
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  z-index: 9999;
  max-width: 480px;
}

.toast-icon {
  font-size: 18px;
}
```

- [ ] **步骤 4：验证页面视图**

```bash
npm run build
```

预期：TypeScript 编译无错误

- [ ] **步骤 5：Commit**

```bash
git add src/views src/index.css
git commit -m "feat: add page views (Role, Skill, Tool, Events, Market, MCP, Settings)"
```

---

## 任务 8：路由配置和 App 入口

**文件：**
- 修改：`src/App.tsx`
- 修改：`src/main.tsx`

- [ ] **步骤 1：更新 App.tsx**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import AppLayout from './components/Layout/AppLayout'
import ChatView from './views/ChatView'
import RoleView from './views/RoleView'
import SkillView from './views/SkillView'
import ToolView from './views/ToolView'
import EventsView from './views/EventsView'
import MarketView from './views/MarketView'
import McpView from './views/McpView'
import SettingsView from './views/SettingsView'
import NotFound from './views/NotFound'
import { useProvidersStore } from './stores/providersStore'
import { useCharactersStore } from './stores/charactersStore'

export default function App() {
  const loadProviders = useProvidersStore(s => s.load)
  const loadCharacters = useCharactersStore(s => s.load)

  useEffect(() => {
    loadProviders()
    loadCharacters()
  }, [])

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/c" replace />} />
        <Route path="/c" element={<ChatView />} />
        <Route path="/c/:id" element={<ChatView />} />
        <Route path="/c/:id/files" element={<ChatView />} />
        <Route path="/c/:id/outline" element={<ChatView />} />
        <Route path="/role" element={<RoleView />} />
        <Route path="/skill" element={<SkillView />} />
        <Route path="/tool" element={<ToolView />} />
        <Route path="/events" element={<EventsView />} />
        <Route path="/market" element={<MarketView />} />
        <Route path="/mcp" element={<McpView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/settings/:tab" element={<SettingsView />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **步骤 2：更新 main.tsx**

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
```

- [ ] **步骤 3：验证完整应用**

```bash
npm run build
```

预期：TypeScript 编译无错误，构建成功

- [ ] **步骤 4：Commit**

```bash
git add src/App.tsx src/main.tsx
git commit -m "feat: configure React Router and App entry point"
```

---

## 任务 9：最终验证和测试

- [ ] **步骤 1：启动开发服务器**

```bash
npm run dev
```

预期：访问 http://localhost:3000 可以看到应用

- [ ] **步骤 2：验证所有页面路由**

测试以下路由：
- `/` → 重定向到 `/c`
- `/c` → 聊天页面
- `/c/:id` → 聊天会话
- `/role` → 角色管理
- `/skill` → 技能管理
- `/tool` → 工具管理
- `/events` → 事件中心
- `/market` → 市场
- `/mcp` → MCP 管理
- `/settings` → 设置
- `/nonexistent` → 404 页面

- [ ] **步骤 3：验证聊天功能**

1. 在输入框输入消息
2. 点击发送按钮或按 Enter
3. 验证消息显示在消息列表中

- [ ] **步骤 4：验证侧边栏切换**

1. 点击导航栏的不同图标
2. 验证页面切换正确
3. 在聊天页面验证侧边栏显示

- [ ] **步骤 5：生产构建**

```bash
npm run build
```

预期：构建成功，无 TypeScript 错误

- [ ] **步骤 6：最终 Commit**

```bash
git add .
git commit -m "feat: complete React frontend refactor"
```

---

## 迁移检查清单

| 功能 | Vue 版本 | React 版本 | 状态 |
|------|----------|------------|------|
| 导航栏 | ✅ | ✅ | 完成 |
| 会话列表侧边栏 | ✅ | ✅ | 完成 |
| 聊天消息流 | ✅ | ✅ | 完成 |
| 消息输入框 | ✅ | ✅ | 完成 |
| 思考块展示 | ✅ | ✅ | 完成 |
| 工具调用展示 | ✅ | ✅ | 完成 |
| 权限审批弹窗 | ✅ | ✅ | 完成 |
| 星官详情面板 | ✅ | ✅ | 完成 |
| 文件面板 | ✅ | ✅ | 完成 |
| 角色管理页面 | ✅ | ✅ | 完成 |
| 技能管理页面 | ✅ | ✅ | 完成 |
| 工具管理页面 | ✅ | ✅ | 完成 |
| 事件中心页面 | ✅ | ✅ | 完成 |
| 市场页面 | ✅ | ✅ | 完成 |
| MCP 管理页面 | ✅ | ✅ | 完成 |
| 设置页面 | ✅ | ✅ | 完成 |
| 404 页面 | ✅ | ✅ | 完成 |
| Socket.IO 实时通信 | ✅ | ✅ | 完成 |
| 状态管理 | Pinia | Zustand | 完成 |
| 路由管理 | Vue Router | React Router | 完成 |
| API 接口层 | ✅ | ✅ | 复用 |
| 中国古风设计 | ✅ | ✅ | 完成 |

---

## 执行选项

计划已完成并保存到 `docs/superpowers/plans/2026-07-23-react-refactor.md`。两种执行方式：

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

选哪种方式？
