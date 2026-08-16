/**
 * ControlRegistry: the model-visible control actions. These are NOT ordinary
 * tools — they are protocol decisions handled at the loop level and are
 * excluded from the executor and from character tool bindings. A control
 * action must be the only tool call in its turn (enforced in inner.ts).
 */

export interface ControlToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

export const CONTROL_TOOL_NAMES = ['delegate_to_agent', 'submit_result', 'ask_user', 'create_plan', 'update_plan_step'] as const

export const CONTROL_TOOL_SET: ReadonlySet<string> = new Set<string>(CONTROL_TOOL_NAMES)

export function getControlToolDefinitions(): ControlToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'update_plan_step',
        description: '更新当前执行计划中的一个步骤。开始执行时标记 in_progress；完成验证后标记 completed 并附 evidence。Plan-first / Goal 模式必须用它推进计划，不能用 create_plan 冒充进度更新。',
        parameters: {
          type: 'object',
          properties: {
            ordinal: { type: 'number', description: '当前有效计划中的步骤序号（从 1 开始）' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped', 'failed'],
              description: '步骤的新状态',
            },
            evidence: { type: 'string', description: '完成证据、验证结果或阻塞原因' },
          },
          required: ['ordinal', 'status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_plan',
        description: '创建或更新执行计划（Plan-first / Goal 模式必用）。把任务拆成有序步骤；步骤完成后调用 submit_result 提交。',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: '计划要达成的目标（可选，默认继承任务）' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '步骤标题' },
                  depends_on: { type: 'string', description: '依赖的步骤标题（可选）' },
                  verification: { type: 'string', description: '该步骤完成的验证方式（可选）' },
                },
                required: ['title'],
              },
              description: '有序步骤列表',
            },
            verification: { type: 'string', description: '整体完成验证标准（可选）' },
          },
          required: ['steps'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_to_agent',
        description: '委托子任务给同组 sub 角色。只有顶层会话（非子会话）可以调用。',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '子任务描述' },
            target_character_id: { type: 'string', description: '目标角色 ID' },
            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'], description: '子任务审批模式（可选，默认继承父会话）' },
          },
          required: ['task', 'target_character_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'submit_result',
        description: '提交最终结果并完成当前任务。调用时附带最终结果的摘要说明。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '任务完成摘要' },
            evidence: { type: 'array', items: { type: 'string' }, description: '支撑结论的证据文件或工具输出（可选）' },
          },
          required: ['summary'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '向用户提出一个必须由用户回答的问题（例如需要确认或输入缺失信息时）。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: '需要用户回答的问题' },
          },
          required: ['question'],
        },
      },
    },
  ]
}
