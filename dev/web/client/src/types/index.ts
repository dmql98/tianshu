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
  reasoning_effort?: string
  input_tokens?: number
  output_tokens?: number
  cache_hit_tokens?: number
  cache_miss_tokens?: number
  cache_hit_ratio?: string | null
  compaction_summary?: string | null
  compaction_until_id?: number | null
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
  description: string
  avatar: string
  color: string
  role: 'main' | 'sub' | 'both'
  groups: string[]
  default_strategy: 'Plan' | 'Ask' | 'Bypass'
  provider: string
  model: string
  maxSteps: number
  tools: { name: string }[]
  skills: string[]
  enabled: boolean
  hidden?: boolean
  soul?: string
  userProfile?: string
  memoryContent?: string
  customPrompt?: string
  memory?: { enabled: boolean; selfEvolution: boolean; charLimit: number }
  createdAt?: number
  updatedAt?: number
}

export interface CharacterStats {
  sessionCount: number
  lastActive: number | null
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
export interface ProviderModel {
  id: string
  name: string
  context_window?: number
  supports_vision?: boolean
}

export interface Provider {
  id: string
  name: string
  base_url: string
  api_key?: string
  has_api_key?: boolean
  envKey?: string
  format?: string
  models: ProviderModel[]
  enabled_models?: string[]
  is_builtin?: boolean
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
  context_window?: number
}

// 工作区
export interface WorkspaceGroup {
  name: string
  sessions: Session[]
  collapsed: boolean
}
