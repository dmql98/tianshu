<script setup lang="ts">
import { ref } from 'vue'

const search = ref('')
const emit = defineEmits<{
  search: [value: string]
}>()

function onInput() {
  emit('search', search.value)
}
</script>

<template>
  <div class="search-bar">
    <input
      v-model="search"
      type="text"
      placeholder="搜索对话..."
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.search-bar {
  padding: 8px;
  border-bottom: 1px solid #e0e0e0;
}
.search-bar input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}
</style>
