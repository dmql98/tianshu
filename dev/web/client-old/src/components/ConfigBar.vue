<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import ModelSelector from './Chat/ModelSelector.vue'
import CharacterSelector from './Chat/CharacterSelector.vue'

const { t } = useI18n()
const chatStore = useChatStore()

const session = computed(() => chatStore.activeSession)

const workspaceList = computed(() => {
  const s = session.value
  if (!s) return []
  return s.workspaces && s.workspaces.length > 0
    ? s.workspaces
    : s.workspace ? [s.workspace] : []
})


</script>

<template>
  <div v-if="session" class="config-bar">
    <label>{{ t('chat.character') }}
      <CharacterSelector />
    </label>
    <label>{{ t('chat.model') }}
      <ModelSelector />
    </label>
    <label class="ws-label">{{ t('chat.workspace') }}
      <div class="ws-chips">
        <span v-for="ws in workspaceList" :key="ws" class="ws-chip" :class="{ 'ws-chip-default': ws === session?.workspace }" :title="ws">{{ ws }}</span>
        <span v-if="workspaceList.length === 0" class="ws-empty">未设置</span>
      </div>
    </label>
  </div>
</template>

<style scoped>
.config-bar { display: flex; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }
.config-bar label { font-size: 12px; color: #666; display: flex; flex-direction: column; gap: 2px; }
.config-bar select, .config-bar input { font-size: 13px; padding: 4px 6px; border: 1px solid #ccc; border-radius: 4px; }
.config-bar input { min-width: 200px; }
.ws-label { min-width: 120px; max-width: 300px; }
.ws-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.ws-chip {
  font-size: 11px; padding: 1px 6px; background: #e3f2fd;
  color: #1976d2; border-radius: 8px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.ws-empty { font-size: 12px; color: #999; font-style: italic; }
.ws-chip-default { background: #e8f5e9; color: #2e7d32; border-color: #c8e6c9; }
</style>
