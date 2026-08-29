// P0-2 工具 schema 体积测量：估算各模式下 tools 参数的字符数与 token 数。
// 运行：cd web/server && node node_modules/tsx/dist/cli.mjs scripts/p02-toolsize-measure.ts
import { getCharacterToolDefinitions, DEFAULT_TOOL_NAMES } from '../src/tools/definitions.js'
import { getControlToolDefinitions } from '../src/agent/loop/control-registry.js'
import * as toolRegistry from '../src/tools/registry.js'

await toolRegistry.init()

type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: any } }

// 字符数 → 粗略 token 数：CJK 每字 1 token（按 1.3 字/token 低估），ASCII 每 4 字符 1 token
function estimateTokens(s: string): number {
  const cjk = (s.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/g) || []).length
  const ascii = s.length - cjk
  return Math.round(cjk / 1.3 + ascii / 4)
}

function ser(defs: ToolDef[]): string {
  return JSON.stringify(defs)
}

function breakdown(defs: ToolDef[]): { name: string; chars: number; tokens: number }[] {
  return defs.map(d => {
    const s = ser([d])
    return { name: d.function.name, chars: s.length, tokens: estimateTokens(s) }
  }).sort((a, b) => b.tokens - a.tokens)
}

const regular = getCharacterToolDefinitions() as ToolDef[] // 默认 12 白名单
const allControl = getControlToolDefinitions() as ToolDef[]

const DIRECT = ['submit_result', 'ask_user', 'delegate_to_agent', 'send_message_to_subagent'] // 最小执行集
const PLAN_GOAL = ['create_plan', 'update_plan_step', 'create_goal', 'get_goal', 'complete_goal']

const controlByName = new Map(allControl.map(d => [d.function.name, d]))

const modes: Record<string, string[]> = {
  'direct(全量9)': allControl.map(d => d.function.name), // 模型自判 → 全部保留
  'direct(最小4)': DIRECT,
  'plan_first(计划2)': [...DIRECT, 'create_plan', 'update_plan_step'],
  'plan_first(全量9)': allControl.map(d => d.function.name),
  'goal(全量9)': allControl.map(d => d.function.name),
}

console.log('=== 常规工具（12 白名单） ===')
console.log(`总 chars=${ser(regular).length}  tokens≈${estimateTokens(ser(regular))}`)
for (const t of breakdown(regular)) console.log(`  ${t.name.padEnd(22)} chars=${String(t.chars).padStart(5)} tokens≈${t.tokens}`)

console.log('\n=== 控制工具（9 个，当前无条件注入） ===')
for (const t of breakdown(allControl)) console.log(`  ${t.name.padEnd(22)} chars=${String(t.chars).padStart(5)} tokens≈${t.tokens}`)
console.log(`合计 chars=${ser(allControl).length} tokens≈${estimateTokens(ser(allControl))}`)

console.log('\n=== 按模式估算（12 常规 + 控制子集，无 MCP） ===')
for (const [mode, names] of Object.entries(modes)) {
  const control = names.map(n => controlByName.get(n)!).filter(Boolean)
  const total = ser([...regular, ...control])
  console.log(`${mode.padEnd(20)} tools=${regular.length + control.length}  chars=${String(total.length).padStart(5)}  tokens≈${estimateTokens(total)}`)
}

// 描述精简后（假设每个控制/长描述工具压到 1-2 句，约 60-120 汉字）的粗估
console.log('\n=== 描述精简后的粗估（假设长描述工具压到 ~100 汉字/条）： ===')