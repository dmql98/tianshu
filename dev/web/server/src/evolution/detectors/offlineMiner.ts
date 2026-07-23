import type { TrajectoryRow } from '../../event/types.js'

export interface ToolCallSummary {
  name: string
  args: Record<string, any>
  result: string
  success: boolean
  duration: number
}

export interface TrajectoryCluster {
  trajectories: TrajectoryRow[]
  signature: string
  firstTool: string
  lengthTier: number
}

function parseToolCalls(row: TrajectoryRow): ToolCallSummary[] {
  try {
    return JSON.parse(row.tool_calls || '[]')
  } catch {
    return []
  }
}

function lcs(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const result: string[] = []
  let i = m; let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1])
      i--; j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  return result
}

function similarity(a: string[], b: string[]): number {
  const lcsSeq = lcs(a, b)
  if (lcsSeq.length === 0) return 0
  return (2 * lcsSeq.length) / (a.length + b.length)
}

function lengthTier(len: number): number {
  if (len <= 3) return 1
  if (len <= 6) return 2
  if (len <= 10) return 3
  return 4
}

export class OfflineMiner {
  static mine(rows: TrajectoryRow[], threshold = 0.65, minClusterSize = 3): TrajectoryCluster[] {
    if (rows.length < 2) return []

    const parsed = rows.map(r => ({ row: r, calls: parseToolCalls(r) }))
      .filter(x => x.calls.length > 0)

    const buckets = new Map<string, TrajectoryRow[]>()
    for (const { row, calls } of parsed) {
      const key = `${calls[0].name}|${lengthTier(calls.length)}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(row)
    }

    const clusters: TrajectoryCluster[] = []

    for (const [, bucket] of buckets) {
      if (bucket.length < minClusterSize) continue

      const toolNames = new Map<string, string[]>()
      for (const row of bucket) {
        const names = parseToolCalls(row).map(c => c.name)
        toolNames.set(row.id, names)
      }

      const ids = bucket.map(r => r.id)
      const parent = new Map<string, string>()
      ids.forEach(id => parent.set(id, id))

      function find(x: string): string {
        while (parent.get(x) !== x) {
          parent.set(x, parent.get(parent.get(x)!)!)
          x = parent.get(x)!
        }
        return x
      }

      function union(a: string, b: string) {
        const ra = find(a); const rb = find(b)
        if (ra !== rb) parent.set(ra, rb)
      }

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const sim = similarity(toolNames.get(ids[i])!, toolNames.get(ids[j])!)
          if (sim >= threshold) union(ids[i], ids[j])
        }
      }

      const groups = new Map<string, TrajectoryRow[]>()
      for (const id of ids) {
        const root = find(id)
        if (!groups.has(root)) groups.set(root, [])
        groups.get(root)!.push(bucket.find(r => r.id === id)!)
      }

      for (const [, group] of groups) {
        if (group.length < minClusterSize) continue
        const firstTool = parseToolCalls(group[0]).map(c => c.name)
        clusters.push({
          trajectories: group,
          signature: [...new Set(firstTool)].slice(0, 3).join(' -> '),
          firstTool: firstTool[0],
          lengthTier: lengthTier(parseToolCalls(group[0]).length),
        })
      }
    }

    return clusters
  }
}
