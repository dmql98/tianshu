<script setup lang="ts">
import { computed } from 'vue'
import MessageList from './MessageList.vue'
import ChatInput from './ChatInput.vue'
import ApprovalDialog from './ApprovalDialog.vue'
import StrategyIndicator from './Chat/StrategyIndicator.vue'
import TokenBar from './TokenBar.vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
const isEventSession = computed(() => chatStore.activeSession?.session_type === 'event')
</script>

<template>
  <main class="chat-area">
    <div v-if="isEventSession" class="readonly-banner">
      <span class="banner-icon">🔒</span>
      <span>事件执行中 · 仅可查看</span>
    </div>
    <StrategyIndicator />
    <MessageList />
    <TokenBar />
    <ChatInput />
    <ApprovalDialog
      v-if="chatStore.pendingApproval"
      :approval="chatStore.pendingApproval"
      @respond="(c: 'once' | 'always' | 'reject') => chatStore.respondApproval(c)"
    />
  </main>
</template>

<style scoped>
.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.readonly-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; font-size: 13px; font-weight: 500;
  background: linear-gradient(135deg, #fecaca, #fed7aa);
  color: #991b1b; border-bottom: 1px solid #fca5a5;
}
.banner-icon { font-size: 16px; }
.banner-sub { margin-left: auto; font-weight: 400; font-size: 12px; opacity: 0.8; }
</style>
