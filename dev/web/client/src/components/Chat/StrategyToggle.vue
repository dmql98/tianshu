<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import type { Strategy } from '@/api/socket'

const chatStore = useChatStore()

function onChange(e: Event) {
  chatStore.setStrategy((e.target as HTMLSelectElement).value as Strategy)
}
</script>

<template>
  <select
    class="strategy-select"
    :value="chatStore.currentStrategy"
    @change="onChange"
  >
    <option value="Plan">Plan</option>
    <option value="Ask">Ask</option>
    <option value="Bypass">Bypass</option>
  </select>
</template>

<style scoped>
.strategy-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  color: #666;
  cursor: pointer;
}
</style>
