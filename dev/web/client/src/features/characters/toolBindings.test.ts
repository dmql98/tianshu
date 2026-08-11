import { describe, expect, it } from 'vitest'
import { dedupeToolBindings, getUnboundTools, toToolBindingName } from './toolBindings'

describe('character tool bindings', () => {
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
