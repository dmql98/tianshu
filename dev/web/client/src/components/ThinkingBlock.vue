<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  content: string
  duration?: number
}>()

const expanded = ref(true)

const formattedDuration = computed(() => {
  if (!props.duration) return ''
  const seconds = (props.duration / 1000).toFixed(1)
  return `${seconds}s`
})

const charCount = computed(() => {
  return props.content.length
})
</script>

<template>
  <div class="thinking-block">
    <div class="thinking-header" @click="expanded = !expanded">
      <span class="thinking-icon">💭</span>
      <span class="thinking-title">思考过程</span>
      <span v-if="formattedDuration" class="thinking-duration">{{ formattedDuration }}</span>
      <span class="thinking-chars">{{ charCount }} chars</span>
      <span class="expand-icon">{{ expanded ? '▼' : '▶' }}</span>
    </div>
    <div v-if="expanded" class="thinking-content">
      {{ content }}
    </div>
  </div>
</template>

<style scoped>
.thinking-block {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 8px;
}
.thinking-header {
  display: flex;
  align-items: center;
  padding: 8px;
  cursor: pointer;
  background: #f8f9fa;
  border-radius: 8px 8px 0 0;
}
.thinking-icon {
  margin-right: 8px;
}
.thinking-title {
  font-weight: 600;
  font-size: 13px;
}
.thinking-duration {
  margin-left: 8px;
  color: #666;
  font-size: 12px;
}
.thinking-chars {
  margin-left: 8px;
  color: #999;
  font-size: 12px;
}
.expand-icon {
  margin-left: auto;
  font-size: 10px;
}
.thinking-content {
  padding: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
