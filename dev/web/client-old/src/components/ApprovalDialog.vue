<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{ approval: { tool_name: string; description: string; tool_call_id: string } }>()
const emit = defineEmits<{ respond: [choice: 'once' | 'always' | 'reject'] }>()
const chatStore = useChatStore()

const title = computed(() => {
  const strategy = chatStore.currentStrategy
  if (strategy === 'Ask') return `[Ask] 确认执行: ${props.approval.tool_name}`
  return `确认执行: ${props.approval.tool_name}`
})

const hint = computed(() => {
  const strategy = chatStore.currentStrategy
  if (strategy === 'Ask') return '当前 Ask 模式，需确认后执行'
  return ''
})
</script>

<template>
  <div class="approval-overlay">
    <div class="approval-dialog">
      <div class="approval-title">{{ title }}</div>
      <div v-if="hint" class="approval-hint">{{ hint }}</div>
      <pre class="approval-detail">{{ approval.description }}</pre>
      <div class="approval-hint approval-args">参数如上，请选择：</div>
      <div class="approval-actions">
        <button class="btn reject" @click="emit('respond', 'reject')">拒绝</button>
        <button class="btn once" @click="emit('respond', 'once')">允许一次</button>
        <button class="btn always" @click="emit('respond', 'always')">本会话允许</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.approval-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 80px; z-index: 100; }
.approval-dialog { background: white; border-radius: 12px; padding: 20px; min-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.approval-title { font-weight: 600; font-size: 16px; margin-bottom: 8px; }
.approval-hint { font-size: 12px; color: #d97706; margin-bottom: 8px; }
.approval-args { margin-bottom: 12px; }
.approval-detail { background: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 13px; max-height: 200px; overflow: auto; margin-bottom: 16px; }
.approval-actions { display: flex; gap: 8px; justify-content: flex-end; }
.btn { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
.once { background: #007aff; color: white; }
.always { background: #34c759; color: white; }
.reject { background: #e0e0e0; color: #333; }
</style>
