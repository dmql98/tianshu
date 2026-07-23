<script setup lang="ts">
defineProps<{
  name: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  toggle: []
  create: []
}>()
</script>

<template>
  <div class="workspace-header">
    <span class="workspace-name" @click="emit('toggle')">
      {{ name }}
      <span class="collapse-icon">{{ collapsed ? '▶' : '▼' }}</span>
    </span>
    <button class="create-btn" @click="emit('create')">+</button>
  </div>
</template>

<style scoped>
.workspace-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  cursor: pointer;
}
.workspace-name {
  font-weight: 600;
  font-size: 13px;
}
.collapse-icon {
  margin-left: 4px;
  font-size: 10px;
}
.create-btn {
  background: none;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
}
</style>
