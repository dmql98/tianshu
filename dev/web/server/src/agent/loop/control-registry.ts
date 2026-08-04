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

export const CONTROL_TOOL_NAMES = ['delegate_to_agent', 'submit_result', 'ask_user', 'create_plan'] as const

export const CONTROL_TOOL_SET: ReadonlySet<string> = new Set<string>(CONTROL_TOOL_NAMES)

export function getControlToolDefinitions(): ControlToolDefinition[] {
  return [
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
            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Risky', 'Auto Approve'], description: '子任务审批模式（可选，默认继承）' },
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
