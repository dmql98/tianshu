// P0-2 描述瘦身评估：三档候选方案体积实测（不改源码，纯测量）。
// 运行：cd web/server && node node_modules/tsx/dist/cli.mjs scripts/p02-slim-eval.ts
import { getCharacterToolDefinitions } from '../src/tools/definitions.js'
import { getControlToolDefinitions, CONTROL_TOOL_NAMES } from '../src/agent/loop/control-registry.js'
import * as toolRegistry from '../src/tools/registry.js'

await toolRegistry.init()

type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: any } }

const NOTE_CURRENT =
  '\n\n⚠️ 协议约束：控制动作不能与其他控制动作或 delegate_to_agent 在同一轮发出（整批拒绝）。' +
  '可与普通工具同轮发出：普通工具会先执行，控制动作随后生效。'
const NOTE_SLIM =
  '\n\n⚠️ 协议约束：控制动作不能与其他控制动作或 delegate_to_agent 同轮发出（整批拒绝）；可与普通工具同轮发出（普通工具先执行）。'

function estimateTokens(s: string): number {
  const cjk = (s.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) || []).length
  const ascii = s.length - cjk
  return Math.round(cjk / 1.3 + ascii / 4)
}

interface SlimSpec {
  description: string
  params?: Record<string, string>          // 覆盖现有参数描述
  dropParams?: string[]                    // 删除参数（死参数）
  dropParamDescs?: string[]                // 删除参数描述（保留参数本身）
}

// 场景 A：保守档——语义完整保留，只压缩冗余解释
const SLIMS_A: Record<string, SlimSpec> = {
  edit: {
    description: '对工作区文件做字符串替换编辑：先精确匹配，兼容空白/缩进漂移；保留文件行尾与 UTF-8 BOM；拒绝歧义或不成比例的匹配；同文件并发编辑自动串行。replaceAll=true 时替换全部出现。',
    params: {
      path: '相对工作区的文件路径',
      oldString: '要查找的文本（尽量带足够上下文保证唯一匹配；缩进/行尾漂移可容忍）',
      newString: '替换文本（必须与 oldString 不同）',
      replaceAll: '替换全部出现而非仅第一处（可选）',
    },
  },
  skill_manager: {
    description: '发现技能包并懒加载激活子技能（写操作已下沉到 REST 技能工作台，模型不直接改盘）。',
    params: {
      action: '先用 list_packages/describe_package 查看，再 activate 激活包内子技能',
      package_id: '技能包 id',
      skill_id: '子技能 id（activate/deactivate 用）',
      skill_name: '包名或 包/子技能 引用（read 用）',
    },
    dropParams: ['package_name', 'description', 'version', 'category', 'content'],
  },
  webfetch: {
    description: '抓取 HTTP(S) URL 内容并返回文本/markdown/html（默认 markdown）。',
    params: {
      url: '要抓取的 URL',
      format: '返回格式 text/markdown/html，默认 markdown',
      readable: '为 true 时先抽取正文（Reader Mode，仅 HTML）',
      timeout: '超时秒数（可选，最大 120）',
    },
  },
  delegate_to_agent: {
    description: '委托子任务给 targets 中的角色（仅顶层会话可调用）。适合上下文隔离的调研/验证/评审，或预算/轮数不足的长任务；子 agent 在独立会话执行、看不到本会话上下文，task 必须自包含（背景+要做什么+返回格式）；结果需综合转述给用户。小事用现有工具解决，没有合适角色不要调用；多角色配合可连续调用多个并行发起。',
  },
  send_message_to_subagent: {
    description: '给本会话已有的子 agent 会话续跑新轮（先 delegate_to_agent 建会话）。sub_session_id 原样照抄此前回注结果 "Sub-session: " 后的完整 ID；执行结果自动回注父会话。',
  },
  create_plan: {
    description: '创建或更新执行计划：把任务拆成有序步骤并注明验证方式。Plan-first/Goal 模式必须创建，Direct 模式可选（由模型自行判断）；完成后调用 submit_result 提交。',
  },
  update_plan_step: {
    description: '更新当前计划步骤状态：执行时 in_progress，完成验证后 completed 并附 evidence；必须用它推进计划，不能用 create_plan 冒充进度更新。',
  },
  create_goal: {
    description: '为会话创建目标（Goal）：outcome 必填，建议带验证标准。已有进行中目标会被拒绝（先 complete_goal）；跨 Run 预算/暂停才用本工具，普通场景在 create_plan 的 goal 字段声明即可。',
  },
  get_goal: { description: '查询当前会话目标（Goal）的内容、验证标准、状态与已用 token。' },
  complete_goal: { description: '将当前进行中的目标标记为已完成（目标确实达成后调用，通常配合 submit_result）。' },
  submit_result: { description: '提交最终结果并完成当前任务，附结果摘要。' },
  ask_user: { description: '向用户提出一个必须由用户回答的问题（需要确认或补充信息时）。' },
}

// 场景 B：激进档——描述更短 + 删除可自解释参数的描述（业界常见做法）
const dropAll: string[] = ['path', 'newString', 'replaceAll', 'url', 'format', 'timeout', 'package_id', 'skill_id', 'skill_name', 'ordinal', 'question', 'summary']
const SLIMS_B: Record<string, SlimSpec> = {
  edit: {
    description: '对工作区文件做字符串替换编辑（容忍空白/缩进漂移，保留行尾与 BOM，拒绝歧义匹配）。',
    params: { oldString: '要查找的文本，尽量带足够上下文保证唯一匹配' },
    dropParamDescs: ['path', 'newString', 'replaceAll'],
  },
  skill_manager: {
    description: '发现技能包并懒加载激活子技能（写操作已下沉到 REST 技能工作台）。',
    params: { action: '先用 list_packages/describe_package 查看，再 activate 激活' },
    dropParams: ['package_name', 'description', 'version', 'category', 'content'],
    dropParamDescs: ['package_id', 'skill_id', 'skill_name'],
  },
  webfetch: {
    description: '抓取 HTTP(S) URL 内容，默认返回 markdown。',
    params: { readable: '为 true 时抽取正文（Reader Mode，仅 HTML）' },
    dropParamDescs: ['url', 'format', 'timeout'],
  },
  delegate_to_agent: {
    description: '委托子任务给 targets 中的角色（仅顶层会话）：子 agent 独立会话执行、看不到本会话上下文，task 必须自包含；结果转述给用户。小事别委托、无合适角色不调用；多角色可连续调用多个并行发起。',
    params: {
      task: '子任务描述（自包含：背景+要做什么+返回格式）',
      target_character_id: '目标角色 ID',
    },
    dropParamDescs: ['sub_strategy'],
  },
  send_message_to_subagent: {
    description: '给本会话已有的子 agent 续跑新轮（先 delegate_to_agent 建会话）；sub_session_id 照抄 "Sub-session: " 后的完整 ID。',
    params: { sub_session_id: '目标子会话 ID（本会话已创建的直接子会话）', message: '发给子 agent 的新任务/补充指令' },
    dropParamDescs: ['sub_strategy'],
  },
  create_plan: {
    description: '创建执行计划：拆成有序步骤并注明验证方式；Plan-first/Goal 必用，Direct 可选；完成后 submit_result 提交。',
    params: { steps: '有序步骤列表（title 必填，可带 depends_on/verification）' },
    dropParamDescs: ['goal', 'verification'],
  },
  update_plan_step: {
    description: '更新计划步骤状态：执行 in_progress，验证完成 completed 附 evidence；不能用 create_plan 冒充进度更新。',
    dropParamDescs: ['ordinal', 'status', 'evidence'],
  },
  create_goal: {
    description: '创建会话目标（Goal）：outcome 必填；已有进行中目标会被拒绝（先 complete_goal）；跨 Run 预算/暂停才用。',
    params: { outcome: '要达成的目标结果' },
    dropParamDescs: ['constraints', 'verification', 'budget_tokens'],
  },
  get_goal: { description: '查询当前会话目标（Goal）状态。' },
  complete_goal: { description: '将当前进行中目标标记为已完成（配合 submit_result）。', dropParamDescs: ['summary'] },
  submit_result: {
    description: '提交最终结果并完成当前任务。',
    params: { summary: '任务完成摘要' },
    dropParamDescs: ['evidence'],
  },
  ask_user: { description: '向用户提出一个必须由用户回答的问题。', dropParamDescs: ['question'] },
}

function ser(defs: ToolDef[]): string {
  return JSON.stringify(defs)
}

function applySlim(def: ToolDef, spec: SlimSpec | undefined, note: string): ToolDef {
  if (!spec) return def
  const f: any = { ...def.function, description: spec.description }
  if (spec.params || spec.dropParams || spec.dropParamDescs) {
    const props: any = { ...def.function.parameters.properties }
    if (spec.params) for (const [k, v] of Object.entries(spec.params)) if (props[k]) props[k] = { ...props[k], description: v }
    if (spec.dropParams) for (const k of spec.dropParams) delete props[k]
    if (spec.dropParamDescs) for (const k of spec.dropParamDescs) if (props[k]) { const { description: _d, ...rest } = props[k]; props[k] = rest }
    f.parameters = { ...def.function.parameters, properties: props }
  }
  if ((CONTROL_TOOL_NAMES as readonly string[]).includes(def.function.name)) f.description += note
  return { ...def, function: f }
}

const regular = getCharacterToolDefinitions() as ToolDef[]
const control = getControlToolDefinitions() as ToolDef[]
const current = [...regular, ...control]

function scenario(name: string, slims: Record<string, SlimSpec>, note: string) {
  const slimmed = current.map(d => applySlim(d, slims[d.function.name], note))
  const curS = ser(current)
  const slimS = ser(slimmed)
  const ct = estimateTokens(curS)
  const st = estimateTokens(slimS)
  const saved = ct - st
  console.log(`\n【${name}】 chars ${curS.length} → ${slimS.length}；tokens≈ ${ct} → ${st}（省 ${saved}，-${Math.round((saved / ct) * 100)}%）`)
  return slimmed
}

console.log('=== 21 工具总计（三模式统一）===')
console.log(`当前基线：chars=${ser(current).length} tokens≈${estimateTokens(ser(current))}`)

const a = scenario('A 保守（语义全保留）', SLIMS_A, NOTE_CURRENT)
const b = scenario('B 激进（删参数描述）', SLIMS_B, NOTE_CURRENT)
const c = scenario('C 激进 + 压缩协议注记', SLIMS_B, NOTE_SLIM)

console.log('\n=== B 逐工具（激进档）===')
const bs = current.map(d => applySlim(d, SLIMS_B[d.function.name], NOTE_CURRENT))
for (let i = 0; i < current.length; i++) {
  const aS = ser([current[i]])
  const bS = ser([bs[i]])
  const diff = estimateTokens(aS) - estimateTokens(bS)
  if (diff !== 0) console.log(`${current[i].function.name.padEnd(24)} ${estimateTokens(aS)} → ${estimateTokens(bS)} tok（省 ${diff}）`)
}
console.log('（token 为 CJK 1.3 字/token + ASCII 4 字符/token 的估算，非供应商精确分词）')