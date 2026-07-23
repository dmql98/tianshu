<script setup lang="ts">
defineProps<{
  activeFilter: 'all' | 'starred'
}>()

const emit = defineEmits<{
  filter: [type: 'all' | 'starred']
}>()
</script>

<template>
  <div class="filter-bar">
    <button class="filter-btn" :class="{ active: activeFilter === 'all' }" @click="emit('filter', 'all')">全部</button>
    <button class="filter-btn" :class="{ active: activeFilter === 'starred' }" @click="emit('filter', 'starred')">收藏</button>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid #e0e0e0;
}
.filter-btn {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}
.filter-btn.active {
  background: #007aff;
  color: white;
  border-color: #007aff;
}
</style>
