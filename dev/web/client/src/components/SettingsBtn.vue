<script setup lang="ts">
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="settings-btn-area">
    <button class="settings-btn" @click="router.push('/settings')">⚙️ Settings</button>
  </div>
</template>

<style scoped>
.settings-btn-area { padding: 8px; border-top: 1px solid #e0e0e0; }
.settings-btn { width: 100%; padding: 6px; background: none; border: 1px solid #ddd; border-radius: 6px; cursor: pointer; font-size: 13px; }
.settings-btn:hover { background: #e9ecef; }
</style>
