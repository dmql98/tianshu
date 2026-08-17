import type { LLMMessage } from '../../llm/client.js'
import { envInt } from '../../config.js'

/**
 * 工具结果头尾剪枝（P0-1）。
 *
 * 对超阈值的工具输出做「保留首部 + 中部省略标记 + 保留尾部」的确定性剪枝，
 * 替代早期「整体替换为 [trimmed]」的做法，减少信息丢失（read/grep/搜索/错误
 * 详情仍保留首尾）。同一输入必须产出同一输出（字节稳定），否则会破坏 provider
 * prefix cache 匹配。
 *
 * 只作用于 tool 消息 content（JSON 字符串）中的 output / error 字段；
 * role、tool_call_id 与 call/result 配对关系保持不变。
 */

/** 中部省略标记，固定文本。 */
export const PRUNE_MARKER = '\n\n[... 工具输出中部已省略 ...]\n\n'

export interface PruneBudgets {
  /** 超过该字符数（按 Unicode code point）才剪枝。 */
  thresholdChars: number
  /** 保留的首部字符数。 */
  headChars: number
  /** 保留的尾部字符数。 */
  tailChars: number
}

// P2-2: 剪枝预算配置化（环境变量，进程级常量）。
export const PRUNE_DEFAULTS: PruneBudgets = {
  thresholdChars: envInt('TSS_PRUNE_THRESHOLD_CHARS', 8192),
  headChars: envInt('TSS_PRUNE_HEAD_CHARS', 4096),
  tailChars: envInt('TSS_PRUNE_TAIL_CHARS', 1024),
}

function resolveBudgets(budgets?: Partial<PruneBudgets>): PruneBudgets {
  return {
    thresholdChars: budgets?.thresholdChars ?? PRUNE_DEFAULTS.thresholdChars,
    headChars: budgets?.headChars ?? PRUNE_DEFAULTS.headChars,
    tailChars: budgets?.tailChars ?? PRUNE_DEFAULTS.tailChars,
  }
}

/** 按 Unicode code point 计数，避免把中文/emoji 拆成 UTF-16 半代理项。 */
export function codePointLength(text: string): number {
  return Array.from(text).length
}

/**
 * 对单个文本做头尾剪枝。
 * @param text 原始文本。
 * @param budgets 剪枝预算（默认 8192 / 4096 / 1024）。
 * @returns 剪枝后的文本；`null` 表示无需剪枝（长度 ≤ threshold）。
 */
export function pruneText(text: string, budgets?: Partial<PruneBudgets>): string | null {
  const { thresholdChars, headChars, tailChars } = resolveBudgets(budgets)
  const points = Array.from(text)
  if (points.length <= thresholdChars) return null

  const removedStart = Math.min(headChars, points.length)
  const removedEnd = Math.max(removedStart, points.length - tailChars)
  // 无实际可删除区间（head+tail 已覆盖全文），保持原样。
  if (removedStart >= removedEnd) return text

  const head = points.slice(0, removedStart).join('')
  const tail = points.slice(removedEnd).join('')
  return head + PRUNE_MARKER + tail
}

/**
 * 对 tool 消息 content（JSON 字符串）做头尾剪枝：只裁剪 output / error 字段。
 * 字节稳定：无需剪枝时返回原字符串（不做 JSON.parse/stringify 重排）。
 * @param content tool 消息的 content（`JSON.stringify({output, error})`）。
 * @returns 剪枝后的 content，或原样 content。
 */
export function pruneToolResultContent(content: string, budgets?: Partial<PruneBudgets>): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return content
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content

  const obj = parsed as Record<string, unknown>
  let needsRewrite = false
  for (const key of ['output', 'error']) {
    const value = obj[key]
    if (typeof value !== 'string') continue
    const pruned = pruneText(value, budgets)
    if (pruned !== null && pruned !== value) {
      obj[key] = pruned
      needsRewrite = true
    }
  }
  return needsRewrite ? JSON.stringify(parsed) : content
}

/**
 * 只读快照：标记一条 tool 消息被剪枝过（供 trimToolResults 判定/计数）。
 * 避免外部依赖字符串比对。剪枝判断本身仍以 pruneToolResultContent 的输出为准。
 */
export function toolResultPruned(content: string, budgets?: Partial<PruneBudgets>): boolean {
  if (typeof content !== 'string') return false
  return pruneToolResultContent(content, budgets) !== content
}

export function pruneToolMessage(m: LLMMessage, budgets?: Partial<PruneBudgets>): LLMMessage {
  if (m.role !== 'tool') return m
  const content = typeof m.content === 'string' ? m.content : ''
  const pruned = pruneToolResultContent(content, budgets)
  if (pruned === content) return m
  return { ...m, content: pruned }
}
