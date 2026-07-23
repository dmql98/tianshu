import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '@/api/tools'

export const useToolsStore = defineStore('tools', () => {
  const allTools = ref<api.ToolMeta[]>([])
  const mcpServers = ref<api.MCPServer[]>([])
  const mcpStatuses = ref<Record<string, api.MCPConnectionStatus>>({})

  const builtinTools = computed(() => allTools.value.filter(t => t.source === 'builtin'))

  async function load() {
    const data = await api.fetchTools()
    allTools.value = data.tools
    mcpServers.value = data.mcpServers
    mcpStatuses.value = data.mcpStatuses || {}
  }

  async function createMCP(data: Partial<api.MCPServer>) {
    const s = await api.createMCPServer(data)
    mcpServers.value.push(s)
  }

  async function updateMCP(id: string, data: Partial<api.MCPServer>) {
    const s = await api.updateMCPServer(id, data)
    const idx = mcpServers.value.findIndex(x => x.id === id)
    if (idx >= 0) Object.assign(mcpServers.value[idx], s)
  }

  async function removeMCP(id: string) {
    await api.deleteMCPServer(id)
    mcpServers.value = mcpServers.value.filter(x => x.id !== id)
  }

  async function testMCP(id: string): Promise<api.MCPTestResult> {
    const result = await api.testMCPConnection(id)
    return result
  }

  return { allTools, builtinTools, mcpServers, mcpStatuses, load, createMCP, updateMCP, removeMCP, testMCP }
})
