<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="not-found">
    <h1>404</h1>
    <p>Page not found</p>
    <button @click="router.push('/')">Back to Chat</button>
  </div>
</template>

<style scoped>
.not-found { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: #666; }
.not-found h1 { font-size: 48px; color: #ccc; }
.not-found button { padding: 8px 16px; border: 1px solid #ddd; border-radius: 6px; background: none; cursor: pointer; }
</style>
