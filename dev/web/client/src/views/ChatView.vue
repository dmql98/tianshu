<script setup lang="ts">
import { watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import ChatArea from '@/components/ChatArea.vue'
import SidePanel from '@/components/Panels/SidePanel.vue'

const route = useRoute()
const chatStore = useChatStore()

watch(() => route.params.id, (id) => {
  if (id && typeof id === 'string') {
    chatStore.switchSession(id)
  }
}, { immediate: true })

const showSidePanel = computed(() => route.name === 'chat-files' || route.name === 'chat-outline')
</script>

<template>
  <div class="chat-view">
    <ChatArea />
    <SidePanel v-if="showSidePanel" />
  </div>
</template>

<style scoped>
.chat-view { flex: 1; display: flex; min-width: 0; }
</style>
