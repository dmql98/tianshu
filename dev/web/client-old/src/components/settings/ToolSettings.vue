<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToolsStore } from '@/stores/tools'

const { t } = useI18n()
const store = useToolsStore()

const builtinTools = computed(() => store.allTools.filter(t => t.source !== 'mcp'))

onMounted(() => { store.load() })
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('toolSetting.title') }}</h3>
    <div class="tool-grid">
      <div v-for="tool in builtinTools" :key="tool.name" class="tool-card">
        <div class="tool-card-header">
          <span class="tool-name">{{ tool.name }}</span>
          <span :class="['tool-source-tag', `tool-source-tag--${tool.source}`]">
            {{ tool.source === 'builtin' ? '内置' : tool.source === 'mcp' ? 'MCP' : '外部导入' }}
          </span>
        </div>
        <p class="tool-desc">{{ tool.description }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section { height: 100%; display: flex; flex-direction: column; }
.section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; flex-shrink: 0; }

.tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.tool-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12px 14px; background: #fafafa; }
.tool-card-header { margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.tool-name { font-size: 13px; font-weight: 600; color: #333; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.tool-source-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 500; white-space: nowrap; flex-shrink: 0; }
.tool-source-tag--builtin { background: #e8f5e9; color: #388e3c; }
.tool-source-tag--mcp { background: #e3f2fd; color: #1976d2; }
.tool-source-tag--external { background: #fff3e0; color: #e65100; }
.tool-desc { font-size: 12px; color: #888; margin: 0; line-height: 1.4; }
</style>
