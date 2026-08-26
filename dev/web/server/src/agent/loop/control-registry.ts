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

/**
 * 独占控制动作：必须独占一轮（不能与其他工具并行）。delegate_to_agent 不在其中——
 * P5 同步 barrier：delegate 可同轮多个并行（各拉起一个子会话），全部完成后父 LLM 才收到结果继续。
 */
export const CONTROL_TOOL_NAMES = ['send_message_to_subagent', 'submit_result', 'ask_user', 'create_plan', 'update_plan_step', 'create_goal', 'get_goal', 'complete_goal'] as const

export const CONTROL_TOOL_SET: ReadonlySet<string> = new Set<string>(CONTROL_TOOL_NAMES)

// The exclusivity rule is enforced in inner.ts (mixed batches are rejected
// atomically). It must ALSO be model-visible: the model can only comply with a
// constraint it can see, so every control description carries this note.
const EXCLUSIVITY_NOTE =
  '\n\n⚠️ 协议约束：控制动作必须独占一轮——不能与任何其他工具调用并行发出，否则整批调用都会被拒绝。' +
  '如需同时执行普通工具，先发普通工具调用，下一轮再单独发出控制动作。'

const BASE_CONTROL_TOOL_DEFINITIONS: ControlToolDefinition[] = [
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
        name: 'create_goal',
        description: '为当前会话创建目标（Goal）。长期或需要多步推进的任务应先用它创建目标（含验证标准），再 create_plan 拆步骤。已有进行中的目标时会被拒绝（先 complete_goal 完成）。',
        parameters: {
          type: 'object',
          properties: {
            outcome: { type: 'string', description: '要达成的目标结果（必填）' },
            constraints: { type: 'string', description: '约束条件（可选）' },
            verification: { type: 'string', description: '验证标准：如何判断目标已达成（可选但推荐）' },
            budget_tokens: { type: 'number', description: '跨 Run 的 token 预算上限（可选）' },
          },
          required: ['outcome'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_goal',
        description: '查询当前会话的目标（Goal）状态：目标内容、验证标准、状态与已用 token。无目标时返回提示。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_goal',
        description: '将当前进行中的目标标记为已完成。仅在目标确实达成后调用；通常配合 submit_result 一起交付。',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: '达成摘要（可选）' },
          },
          required: [],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_to_agent',
        description:
          '委托子任务给 targets 中列出的角色（仅顶层会话可调用，子会话无法再委托）。' +
          '适合场景：需要上下文隔离的大范围调研/检索、需要独立视角的验证或评审、或当前会话预算/轮数不足的长任务。' +
          '子 agent 在独立会话中执行并返回结果；它有自己的角色人设与记忆，但看不到本会话上下文，' +
          '因此 task 必须自包含（说明背景、要求做什么、要返回什么格式）。' +
          '拿到结果后必须综合/转述给用户，子 agent 的结果用户不可见。' +
          '分配规则：仅在目标任务明显属于某 target 的专长、且自己处理会消耗大量上下文时才委托；' +
          '能直接用现有工具（read/grep/glob 等）快速解决的小事不要委托；没有合适角色时不要委托，自己做。' +
          '需要多个角色配合时（如先调研再评审、或塔罗+易经综合解答），可在同一回复中连续调用多个 delegate_to_agent 并行发起。' +
          '若描述中未列出可委托目标（targets 为空），说明当前未配置可委托角色，请勿调用。',
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
        name: 'send_message_to_subagent',
        description:
          '给本会话已存在的子 agent 会话续跑一个新 turn（P4 多轮：先 delegate_to_agent 建子会话，之后可用本工具让同一子 agent 继续执行后续任务）。' +
          '适合：子 agent 首轮结果不完整需要补充调研、需要让同一独立上下文继续深入、或分阶段派活给同一 worker。' +
          'sub_session_id 直接复用此前子代理回注结果开头 "Sub-session: " 后的完整 ID（原样照抄，不要改写），无需用户提供。' +
          '子 agent 执行完成后结果会回注到父会话的对应消息并自动汇报。',
        parameters: {
          type: 'object',
          properties: {
            sub_session_id: { type: 'string', description: '目标子会话 ID（必须是本会话已创建的直接子会话）' },
            message: { type: 'string', description: '发给子 agent 的新任务/补充指令' },
            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'], description: '子任务审批模式（可选，默认继承子会话既有策略）' },
          },
          required: ['sub_session_id', 'message'],
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

export function getControlToolDefinitions(): ControlToolDefinition[] {
  return BASE_CONTROL_TOOL_DEFINITIONS.map(d => ({
    ...d,
    // 独占约束仅对 CONTROL_TOOL_NAMES 中的控制动作可见；delegate_to_agent 可批量并行，不加 note。
    function: CONTROL_TOOL_SET.has(d.function.name)
      ? { ...d.function, description: d.function.description + EXCLUSIVITY_NOTE }
      : { ...d.function },
  }))
}
