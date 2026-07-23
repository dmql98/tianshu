import type { TrajectoryCluster } from '../detectors/offlineMiner.js'

export interface SkillDraft {
  name: string
  description: string
  trigger: string
  steps: string[]
  examples: string[]
}

export class InsightExtractor {
  static extract(cluster: TrajectoryCluster): SkillDraft {
    const firstTool = cluster.firstTool
    const toolSet = new Set<string>()
    for (const t of cluster.trajectories) {
      const calls = JSON.parse(t.tool_calls || '[]') as any[]
      for (const c of calls) toolSet.add(c.name || '')
    }

    return {
      name: `${firstTool}_pattern_${cluster.lengthTier}`,
      description: `Cluster of ${cluster.trajectories.length} trajectories with signature: ${cluster.signature}`,
      trigger: `When user's task involves ${firstTool} operations`,
      steps: [`Use ${firstTool} for initial exploration`, ...[...toolSet].filter(t => t !== firstTool).map(t => `Follow up with ${t} if needed`)],
      examples: cluster.trajectories.slice(0, 2).map(t => {
        const calls = JSON.parse(t.tool_calls || '[]') as any[]
        return calls.map((c: any) => `${c.name}: ${JSON.stringify(c.args)}`).join('\n')
      }),
    }
  }
}
