<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const label = computed(() => {
  const s = chatStore.currentStrategy
  return s === 'Plan' ? 'Plan (只读)' : s === 'Ask' ? 'Ask (需确认)' : 'Bypass (直接执行)'
})
</script>

<template>
  <div v-if="chatStore.activeSession" class="strategy-indicator" :class="chatStore.currentStrategy.toLowerCase()">
    <span class="dot"></span>
    <span class="strategy-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.strategy-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  border-bottom: 1px solid #e0e0e0;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.strategy-indicator.plan {
  background: #f0f4ff;
  color: #2563eb;
}
.strategy-indicator.plan .dot { background: #2563eb; }
.strategy-indicator.ask {
  background: #fffbeb;
  color: #d97706;
}
.strategy-indicator.ask .dot { background: #d97706; }
.strategy-indicator.bypass {
  background: #f0fdf4;
  color: #16a34a;
}
.strategy-indicator.bypass .dot { background: #16a34a; }
</style>
