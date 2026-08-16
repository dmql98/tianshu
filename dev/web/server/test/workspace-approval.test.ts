import { describe, expect, it, vi } from 'vitest'
import { decideWorkspaceApproval } from '../src/agent/workspace-approval.js'

describe('workspace approval strategy', () => {
  it('automatically and persistently authorizes paths in Auto Approve mode', async () => {
    const prompt = vi.fn(async () => 'reject' as const)

    await expect(decideWorkspaceApproval('Auto Approve', prompt)).resolves.toBe('always')
    expect(prompt).not.toHaveBeenCalled()
  })

  it.each(['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace'] as const)('keeps workspace prompts for %s', async strategy => {
    const prompt = vi.fn(async () => 'once' as const)

    await expect(decideWorkspaceApproval(strategy, prompt)).resolves.toBe('once')
    expect(prompt).toHaveBeenCalledOnce()
  })
})
