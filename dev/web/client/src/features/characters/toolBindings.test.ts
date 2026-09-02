import { describe, expect, it } from 'vitest'
import { dedupeToolBindings, getUnboundTools, isAutoManagedTool, toToolBindingName } from './toolBindings'

describe('character tool bindings', () => {
  it('marks auto-managed tools (memory / skill_manager) so UI can hide them', () => {
    for (const name of ['memory_read', 'memory_write', 'memory_update', 'memory_archive', 'memory_snapshot']) {
      expect(isAutoManagedTool(name)).toBe(true)
    }
    expect(isAutoManagedTool('skill_manager')).toBe(true)
    expect(isAutoManagedTool('read')).toBe(false)
    expect(isAutoManagedTool('bash')).toBe(false)
  })

  it('excludes auto-managed tools from unbound candidates', () => {
    const candidates = [
      { name: 'read', source: 'builtin' },
      { name: 'skill_manager', source: 'builtin' },
      { name: 'memory_read', source: 'builtin' },
      { name: 'bash', source: 'builtin' },
    ]
    const unbound = getUnboundTools(candidates, []).filter(c => !isAutoManagedTool(c.name))
    expect(unbound.map(c => c.name)).toEqual(['read', 'bash'])
  })

  it('uses the persisted mcp: prefix for MCP candidates', () => {
    expect(toToolBindingName('filesystem', 'mcp')).toBe('mcp:filesystem')
    expect(toToolBindingName('mcp:filesystem', 'mcp')).toBe('mcp:filesystem')
    expect(toToolBindingName('bash', 'builtin')).toBe('bash')
  })

  it('removes activated MCP tools from the candidate list', () => {
    const candidates = [
      { name: 'bash', source: 'builtin' },
      { name: 'filesystem', source: 'mcp' },
    ]
    expect(getUnboundTools(candidates, [{ name: 'mcp:filesystem' }])).toEqual([
      { name: 'bash', source: 'builtin' },
    ])
  })

  it('deduplicates legacy bindings and duplicate candidates', () => {
    expect(dedupeToolBindings([
      { name: 'mcp:filesystem' },
      { name: 'mcp:filesystem' },
      { name: 'bash' },
    ])).toEqual([{ name: 'mcp:filesystem' }, { name: 'bash' }])

    expect(getUnboundTools([
      { name: 'filesystem', source: 'mcp' },
      { name: 'filesystem', source: 'mcp' },
    ], [])).toHaveLength(1)
  })
})
