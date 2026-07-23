<script setup lang="ts">
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()
</script>

<template>
  <div class="batch-actions">
    <div class="batch-info">
      已选择 {{ chatStore.selectedSessionIds.size }} 个会话
    </div>
    <div class="batch-buttons">
      <button @click="chatStore.selectAllSessions()">
        {{ chatStore.selectedSessionIds.size === chatStore.sessions.length ? '取消全选' : '全选' }}
      </button>
      <button @click="chatStore.batchDeleteSessions()" class="danger" :disabled="chatStore.selectedSessionIds.size === 0">
        批量删除
      </button>
      <button @click="chatStore.toggleBatchMode()">取消</button>
    </div>
  </div>
</template>

<style scoped>
.batch-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  border-top: 1px solid #e0e0e0;
  background: #f8f9fa;
}
.batch-info {
  font-size: 12px;
  color: #666;
}
.batch-buttons {
  display: flex;
  gap: 4px;
}
.batch-buttons button {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}
.batch-buttons button.danger {
  color: #ff3b30;
  border-color: #ff3b30;
}
.batch-buttons button.danger:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
