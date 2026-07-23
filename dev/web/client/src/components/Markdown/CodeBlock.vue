<script setup lang="ts">
import { ref, onMounted } from 'vue'
import hljs from 'highlight.js'

const props = defineProps<{
  code: string
  language?: string
}>()

const codeRef = ref<HTMLElement>()
const copied = ref(false)

onMounted(() => {
  if (codeRef.value && props.language) {
    hljs.highlightElement(codeRef.value)
  }
})

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
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
  <div class="code-block">
    <div class="code-header">
      <span class="language">{{ language || 'code' }}</span>
      <button class="copy-btn" @click="copyCode">
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <pre><code ref="codeRef" :class="language">{{ code }}</code></pre>
  </div>
</template>

<style scoped>
.code-block {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin: 8px 0;
  overflow: hidden;
}
.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
}
.language {
  font-size: 12px;
  color: #666;
}
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
pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
}
code {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
}
</style>
