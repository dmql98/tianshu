export interface ToolConstraint {
  allowed_paths?: string[]
  denied_paths?: string[]
  max_file_size?: string
  allowed_commands?: string[]
  denied_patterns?: string[]
  readonly?: boolean
  max_rows?: number
}

export interface ConstraintField {
  key: string
  label: string
  type: 'string-list' | 'string' | 'boolean' | 'number'
  placeholder?: string
  validateArg?: string
  validateRule?: string
}

export interface ToolBinding {
  name: string
  constraints?: ToolConstraint
}

export interface ToolResult {
  output: string
  error?: string
  escaped?: boolean
  // Media produced by the tool (e.g. an image fetched by webfetch). Bytes are
  // passed inline as base64; the agent layer persists them via the media store
  // and re-emits them as multimodal content blocks for vision-capable models.
  attachments?: Array<{ name: string; mime: string; data: string }>
}

export interface ToolContext {
  workspace: string
  workspaces?: string[]
  signal?: AbortSignal
  allowedRoots?: string[]
  onOutput?: (chunk: string) => void
}

export interface ToolModule {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
  dangerous?: boolean
  signal?: boolean
  constraintFields?: ConstraintField[]
  execute: (args: Record<string, string>, ctx: ToolContext) => Promise<ToolResult>
}
