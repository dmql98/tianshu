<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
const chatStore = useChatStore()
</script>

<template>
  <div class="session-list">
    <div class="session-list-header">
      <span class="title">Sessions</span>
      <button class="new-btn" @click="chatStore.createSession(); chatStore.switchSession(chatStore.sessions[0].id)">+</button>
    </div>
    <div
      v-for="s in chatStore.sessions"
      :key="s.id"
      class="session-item"
      :class="{ active: s.id === chatStore.activeSessionId }"
      @click="chatStore.switchSession(s.id)"
    >
      <span class="session-title">{{ s.title || 'New Chat' }}</span>
    </div>
  </div>
</template>

<style scoped>
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-list-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 0 8px; }
.title { font-weight: 600; font-size: 14px; }
.new-btn { background: none; border: 1px solid #ccc; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.session-item { padding: 8px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 2px; }
.session-item:hover { background: #e9ecef; }
.session-item.active { background: #d0ebff; font-weight: 500; }
</style>
