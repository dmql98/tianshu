// 会话相关
export const STRATEGIES = ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'] as const
export type Strategy = typeof STRATEGIES[number]

export function normalizeStrategy(value: unknown, fallback: Strategy = 'Ask Risky'): Strategy {
  if (STRATEGIES.includes(value as Strategy)) return value as Strategy
  if (value === 'Plan') return 'Read Only'
  if (value === 'Ask') return 'Ask Risky'
  if (value === 'Bypass') return 'Auto Approve'
  return fallback
}

export interface SessionSummary {
  id: string
  character_id: string
  title: string
  model: string | null
  provider_id: string | null
  workspace: string | null
  workspaces: string | null
  dataspace: string | null
  parent_id: string | null
  active_group: string | null
  session_type?: 'chat' | 'event'
  event_id?: string | null
  current_strategy?: Strategy
  context_window?: number | null
  reasoning_effort?: string
  execution_mode?: string
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
  context_usage?: number
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
  token_speed?: number
  token_speed_estimated?: boolean
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
  default_strategy: Strategy
  provider: string
  model: string
  maxSteps: number
  tools: { name: string }[]
  skills: string[]
  skillBindings?: SkillBinding[]
  enabled: boolean
  hidden?: boolean
  soul?: string
  userProfile?: string
  memoryContent?: string
  customPrompt?: string
  memory?: { enabled: boolean; selfEvolution: boolean; charLimit: number }
  runPolicy?: CharacterRunPolicyView
  createdAt?: number
  updatedAt?: number
  /** 双层内容来源（BUILTIN_CONTENT_DEVELOPMENT_PLAN §12）。 */
  source?: 'builtin' | 'user'
  readOnly?: boolean
  overridesBuiltin?: boolean
  builtinVersion?: string
}

export interface CharacterRunPolicyView {
  configured?: {
    version: 1
    softTurns?: number
    graceTurns?: number
    autoContinuation?: 'inherit' | 'enabled' | 'disabled'
    maxAutoContinuations?: number
  }
  effectivePreview?: {
    softTurns: number
    graceTurns: number
    absoluteTurns: number
    autoContinuation: boolean
    maxAutoContinuations: number
    maxChainTurns: number
    maxChainTokens: number
    maxChainWallTimeMs: number
    noProgressThreshold: number
    weakProgressThreshold: number
    repeatedToolLoopThreshold: number
  }
  constrainedFields?: string[]
}

export interface SkillBinding {
  packageId: string
  enabled?: boolean
  preloadSkills?: string[]
  disabledSkills?: string[]
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
  preset_id?: string
  runtime_plugin?: string
}

// Socket 事件
export interface RunEvent {
  event_id?: string
  session_id: string
  run_id?: string
  seq?: number
  type?: string
  occurred_at?: number
  delta?: string
  reasoning?: string
  output?: string
  tool_name?: string
  tool_input?: string
  tool_output?: string
  tool_call_id?: string
  tool_status?: string
  strategy?: string
  error?: string
  attempt?: number
  max_attempts?: number
  delay_ms?: number
  scope?: 'request' | 'run'
  cache?: { hitTokens: number; missTokens: number; hitRatio: string }
  context_window?: number
  message_id?: number
  user_message_id?: number
  token_speed?: number
  token_speed_estimated?: boolean
  question?: string
  approval_kind?: 'workspace' | 'risk'
  requested_path?: string
  permission_root?: string
  limit_summary?: RunLimitSummary
  result?: { limitSummary?: RunLimitSummary; continuationScheduled?: boolean; nextRunId?: string }
  continuationScheduled?: boolean
  next_run_id?: string
  continuation_index?: number
  trigger?: 'manual' | 'user_input' | 'auto_limit'
  reason?: string
  soft_turns?: number
  absolute_turns?: number
}

export type RunLimitReason =
  | 'no_progress_after_soft_limit'
  | 'absolute_limit'
  | 'repeated_tool_loop'
  | 'continuation_limit'

export interface RunLimitSummary {
  reason: RunLimitReason
  policyVersion: number
  softTurns: number
  absoluteTurns: number
  turnsUsed: number
  graceTurnsUsed: number
  noProgressStreak: number
  continuationScheduled: boolean
  nextRunId?: string
}

export const REASON_LABELS: Record<RunLimitReason, string> = {
  no_progress_after_soft_limit: '连续多轮没有可验证进展，本轮已停止',
  absolute_limit: '已达到系统单轮安全上限',
  repeated_tool_loop: '检测到重复工具循环，本轮已停止',
  continuation_limit: '已达到自动续跑安全预算，可手动检查后继续',
}

// 工作区
export interface WorkspaceGroup {
  name: string
  sessions: Session[]
  collapsed: boolean
}
