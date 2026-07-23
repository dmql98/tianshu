<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  text: string
}>()

const copied = ref(false)

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}
</script>

<template>
  <button class="copy-btn" @click="copyToClipboard">
    {{ copied ? '已复制' : '复制' }}
  </button>
</template>

<style scoped>
.copy-btn {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
}
.copy-btn:hover {
  background: #f0f0f0;
}
</style>
