# P2-1: 参数化 SOFT_COMPACT_RATIO / SNIP_RATIO（env + 模型级 snipRatio）
# CRLF 安全：读原始字节 → 归一化 \r\n → \n → 替换 → 写回 \r\n
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent  # web/server

def load(p: Path) -> str:
    return p.read_text(encoding='utf-8', newline='').replace('\r\n', '\n')

def save(p: Path, s: str) -> None:
    p.write_text(s.replace('\n', '\r\n'), encoding='utf-8', newline='')

def apply(p: Path, pairs: list[tuple[str, str]]) -> None:
    s = load(p)
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f'MISS({n}) in {p.name}: {old[:70]!r}')
            sys.exit(1)
        s = s.replace(old, new, 1)
    save(p, s)
    print(f'OK {p.name}')

# ── 1. config.ts: 新增 envFloat（非负浮点 env，缺失/非法回退默认） ──
apply(BASE / 'src/config.ts', [
    (
"""/**
 * 读取非负整数环境变量，缺失/非法时回退默认值。
 * 供上下文阈值类配置使用（P2-2：配置化）。
 */
export function envInt(name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : def
}""",
"""/**
 * 读取非负整数环境变量，缺失/非法时回退默认值。
 * 供上下文阈值类配置使用（P2-2：配置化）。
 */
export function envInt(name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : def
}

/**
 * 读取非负浮点环境变量（比例类阈值，如 0.5/0.6），缺失/非法时回退默认值。
 * 供 snip/soft-compact 比例类配置使用（P2-1：配置化）。
 */
export function envFloat(name: string, def: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? n : def
}""",
    ),
])

# ── 2. loop-policy.ts: env 化常量 + CompactPolicy.snipRatio + shouldSnip( Tokens) 走 policy ──
apply(BASE / 'src/agent/loop/loop-policy.ts', [
    # import envFloat
    (
"import { envInt } from '../../config.js'",
"import { envFloat, envInt } from '../../config.js'",
    ),
    # 两个硬编码常量 → env（P2-1）
    (
"""export const SOFT_COMPACT_RATIO = 0.5
export const SNIP_RATIO = 0.6""",
"""/** P2-1: 软提示日志阈值（outer.ts 打日志用，无行为影响），可经 TSS_SOFT_COMPACT_RATIO 覆盖。 */
export const SOFT_COMPACT_RATIO = envFloat('TSS_SOFT_COMPACT_RATIO', 0.5)
/** P2-1: 剪枝触发阈值（trimToolResults），可经 TSS_SNIP_RATIO / 模型级 compact_snip_ratio 覆盖（模型级优先）。 */
export const SNIP_RATIO = envFloat('TSS_SNIP_RATIO', 0.6)""",
    ),
    # CompactPolicy 接口加 snipRatio
    (
"""export interface CompactPolicy {
  thresholdRatio: number
  retainRatio: number
  summarizationProvider?: string
  summarizationModel?: string
}

export const DEFAULT_COMPACT_POLICY: CompactPolicy = {
  thresholdRatio: COMPACT_THRESHOLD,
  retainRatio: COMPACT_RETAIN_RATIO,
}

export function resolveCompactPolicy(modelConfig?: {
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_provider?: string
  compact_model?: string
} | null): CompactPolicy {
  return {
    thresholdRatio: modelConfig?.compact_threshold_ratio ?? COMPACT_THRESHOLD,
    retainRatio: modelConfig?.compact_retain_ratio ?? COMPACT_RETAIN_RATIO,
    summarizationProvider: modelConfig?.compact_provider ?? '',
    summarizationModel: modelConfig?.compact_model ?? '',
  }
}""",
"""export interface CompactPolicy {
  thresholdRatio: number
  retainRatio: number
  /** P2-1: 剪枝触发阈值（trimToolResults）；未配置回退全局 SNIP_RATIO。 */
  snipRatio: number
  summarizationProvider?: string
  summarizationModel?: string
}

export const DEFAULT_COMPACT_POLICY: CompactPolicy = {
  thresholdRatio: COMPACT_THRESHOLD,
  retainRatio: COMPACT_RETAIN_RATIO,
  snipRatio: SNIP_RATIO,
}

export function resolveCompactPolicy(modelConfig?: {
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_snip_ratio?: number
  compact_provider?: string
  compact_model?: string
} | null): CompactPolicy {
  return {
    thresholdRatio: modelConfig?.compact_threshold_ratio ?? COMPACT_THRESHOLD,
    retainRatio: modelConfig?.compact_retain_ratio ?? COMPACT_RETAIN_RATIO,
    snipRatio: modelConfig?.compact_snip_ratio ?? SNIP_RATIO,
    summarizationProvider: modelConfig?.compact_provider ?? '',
    summarizationModel: modelConfig?.compact_model ?? '',
  }
}""",
    ),
    # shouldSnip / shouldSnipTokens 走 policy
    (
"""export function shouldSnip(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return estimateTokens(messages) > contextWindow * SNIP_RATIO
}""",
"""export function shouldSnip(messages: LLMMessage[], contextWindow = DEFAULT_CONTEXT_WINDOW, policy: CompactPolicy = DEFAULT_COMPACT_POLICY): boolean {
  return estimateTokens(messages) > contextWindow * policy.snipRatio
}""",
    ),
    (
"""export function shouldSnipTokens(usedTokens: number, contextWindow = DEFAULT_CONTEXT_WINDOW): boolean {
  return usedTokens > contextWindow * SNIP_RATIO
}""",
"""export function shouldSnipTokens(usedTokens: number, contextWindow = DEFAULT_CONTEXT_WINDOW, policy: CompactPolicy = DEFAULT_COMPACT_POLICY): boolean {
  return usedTokens > contextWindow * policy.snipRatio
}""",
    ),
])

# ── 3. outer.ts: 调用处传 compactPolicy ──
apply(BASE / 'src/agent/outer.ts', [
    (
"  if (shouldSnip(messages, contextWindow)) {",
"  if (shouldSnip(messages, contextWindow, compactPolicy)) {",
    ),
])

# ── 4. loop-engine.ts（LF 文件；仍归一化安全处理） ──
apply(BASE / 'src/agent/loop/loop-engine.ts', [
    (
"    if (shouldSnipTokens(projectedTokens, contextWindow)) {",
"    if (shouldSnipTokens(projectedTokens, contextWindow, compactPolicy)) {",
    ),
])

# ── 5. providerStore.ts: ModelInfo 加 compact_snip_ratio ──
apply(BASE / 'src/db/providerStore.ts', [
    (
"""  /** P1-4 模型级压缩策略（未配置回退全局默认）：触发阈值 / 保留比。 */
  compact_threshold_ratio?: number
  compact_retain_ratio?: number""",
"""  /** P1-4 模型级压缩策略（未配置回退全局默认）：触发阈值 / 保留比。 */
  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  /** P2-1 模型级剪枝阈值（shouldSnip，未配置回退全局 TSS_SNIP_RATIO=0.6）。 */
  compact_snip_ratio?: number""",
    ),
])

print('ALL OK')