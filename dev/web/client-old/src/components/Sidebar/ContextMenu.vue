<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  sessionId: string
  pinned: boolean
}>()

const menuItems = computed(() => [
  { label: props.pinned ? '取消收藏' : '收藏', key: 'pin' },
  { label: '重命名', key: 'rename' },
  { label: '复制 ID', key: 'copy-id' },
  { label: '导出', key: 'export' },
  { label: '删除', key: 'delete', danger: true },
])

const emit = defineEmits<{
  close: []
  action: [action: string, sessionId: string]
}>()

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.context-menu')) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

function handleAction(key: string) {
  emit('action', key, props.sessionId)
  emit('close')
}
</script>

<template>
  <div
    v-if="visible"
    class="context-menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
  >
    <div
      v-for="item in menuItems"
      :key="item.key"
      class="menu-item"
      :class="{ danger: item.danger }"
      @click="handleAction(item.key)"
    >
      {{ item.label }}
    </div>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  padding: 4px;
  z-index: 1000;
  min-width: 150px;
}
.menu-item {
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}
.menu-item:hover {
  background: #f0f0f0;
}
.menu-item.danger {
  color: #ff3b30;
}
</style>
