/**
 * ControlRegistry: the model-visible control actions. These are NOT ordinary
 * tools — they are protocol decisions handled at the loop level and are
 * excluded from the executor and from character tool bindings.
 *
 * P0-3 项3（控制动作解独占）：控制动作不再强制独占一轮——可与其他普通工具同轮
 * 发出（普通工具先执行，控制动作随后生效，整批不再被拒绝）。仍不可调和的组合
 * （整批拒绝，见 inner.ts）：
 *   - 同轮多个控制动作（互斥）；
 *   - 控制动作 + delegate_to_agent 并行（delegate 是控制类屏障，保持分离）。
 */

export interface ControlToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

/**
 * 控制动作（P0-3 项3 解独占）：不再强制独占一轮——可与普通工具同轮发出（普通工具
 * 先执行，控制动作随后生效）。仍互斥：多个控制动作同轮、或控制动作 + delegate_to_agent
 * 并行会被整批拒绝。delegate_to_agent 不在其中——P5 同步 barrier：delegate 可同轮多个
 * 并行（各拉起一个子会话），全部完成后父 LLM 才收到结果继续。
 */
export const CONTROL_TOOL_NAMES = ['send_message_to_subagent', 'submit_result', 'ask_user', 'create_plan', 'update_plan_step', 'create_goal', 'get_goal', 'complete_goal'] as const

export const CONTROL_TOOL_SET: ReadonlySet<string> = new Set<string>(CONTROL_TOOL_NAMES)

// The exclusivity rule (control-vs-control and control-vs-delegate) is enforced
// in inner.ts (mixed batches are rejected atomically). It must ALSO be
// model-visible: the model can only comply with a constraint it can see, so
// every control description carries this note.
const EXCLUSIVITY_NOTE =
  '\n\n⚠️ 协议约束：控制动作不能与其他控制动作或 delegate_to_agent 同轮发出（整批拒绝）；可与普通工具同轮发出（普通工具先执行）。'

const BASE_CONTROL_TOOL_DEFINITIONS: ControlToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'update_plan_step',
        description: '更新计划步骤状态：执行 in_progress，验证完成 completed 附 evidence；Plan-first/Goal 模式必须用它推进计划，不能用 create_plan 冒充进度更新。',
        parameters: {
          type: 'object',
          properties: {
            ordinal: { type: 'number' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped', 'failed'],
            },
            evidence: { type: 'string' },
          },
          required: ['ordinal', 'status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_plan',
        description: '创建执行计划：拆成有序步骤并注明验证方式；Plan-first/Goal 必用，Direct 可选；完成后 submit_result 提交。',
        parameters: {
          type: 'object',
          properties: {
            goal: { type: 'string' },
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
              description: '有序步骤列表（title 必填，可带 depends_on/verification）',
            },
            verification: { type: 'string' },
          },
          required: ['steps'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_goal',
        description: '创建会话目标（Goal）：outcome 必填；已有进行中目标会被拒绝（先 complete_goal）；跨 Run 预算/暂停才用。',
        parameters: {
          type: 'object',
          properties: {
            outcome: { type: 'string', description: '要达成的目标结果' },
            constraints: { type: 'string' },
            verification: { type: 'string' },
            budget_tokens: { type: 'number' },
          },
          required: ['outcome'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_goal',
        description: '查询当前会话目标（Goal）状态。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_goal',
        description: '将当前进行中目标标记为已完成（配合 submit_result）。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_to_agent',
        description: '把可自包含、可并行的子任务委托给子代理，是处理大任务最快的方式：子 agent 在独立会话执行（看不到本会话上下文），task 必须自包含、写清返回格式，结果由其转述给用户。可连续调用多个并行发起（仅顶层会话）。target_character_id 必须是你配置在可委托列表（targets）中的角色；若当前角色未配置任何可委托角色，则无法委派（不要臆造角色 ID）。',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '子任务描述（自包含：背景+要做什么+返回格式）' },
            target_character_id: { type: 'string', description: '目标角色 ID' },
            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'] },
          },
          required: ['task', 'target_character_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'send_message_to_subagent',
        description: '给本会话已有的子 agent 续跑新轮（先 delegate_to_agent 建会话，执行完成后才返回结果）；sub_session_id 照抄 "Sub-session: " 后的完整 ID。',
        parameters: {
          type: 'object',
          properties: {
            sub_session_id: { type: 'string', description: '目标子会话 ID（本会话已创建的直接子会话）' },
            message: { type: 'string', description: '发给子 agent 的新任务/补充指令' },
            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'] },
          },
          required: ['sub_session_id', 'message'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'submit_result',
        description: '提交最终结果并完成当前任务。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '任务完成摘要' },
            evidence: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: '向用户提出一个必须由用户回答的问题。',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
          },
          required: ['question'],
        },
      },
    },
  ]

export function getControlToolDefinitions(): ControlToolDefinition[] {
  return BASE_CONTROL_TOOL_DEFINITIONS.map(d => ({
    ...d,
    // 互斥约束仅对 CONTROL_TOOL_NAMES 中的控制动作可见；delegate_to_agent 可批量并行，不加 note。
    function: CONTROL_TOOL_SET.has(d.function.name)
      ? { ...d.function, description: d.function.description + EXCLUSIVITY_NOTE }
      : { ...d.function },
  }))
}
