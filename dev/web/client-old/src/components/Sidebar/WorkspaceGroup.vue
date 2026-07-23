<script setup lang="ts">
import WorkspaceHeader from './WorkspaceHeader.vue'
import SessionItem from './SessionItem.vue'
import { useChatStore } from '@/stores/chat'
import type { WorkspaceGroup as WorkspaceGroupType } from '@/stores/chat'

const props = defineProps<{
  workspace: WorkspaceGroupType
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const chatStore = useChatStore()

function createSessionInWorkspace() {
  chatStore.createSession({ workspace: props.workspace.name })
}
</script>

<template>
  <div class="workspace-group">
    <WorkspaceHeader
      :name="workspace.name"
      :collapsed="workspace.collapsed"
      @toggle="chatStore.toggleWorkspaceCollapse(workspace.name)"
      @create="createSessionInWorkspace"
    />
    <div v-if="!workspace.collapsed" class="workspace-sessions">
      <SessionItem
        v-for="session in workspace.sessions"
        :key="session.id"
        :session="session"
        :active="session.id === chatStore.activeSessionId"
        @click="emit('select', session.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.workspace-group {
  margin-bottom: 8px;
}
.workspace-sessions {
  padding-left: 8px;
}
</style>
