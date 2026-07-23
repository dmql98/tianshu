<script setup lang="ts">
import ToolSettings from '@/components/settings/ToolSettings.vue'
</script>

<template>
  <div class="page-view">
    <ToolSettings />
  </div>
</template>

<style scoped>
.page-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  overflow: hidden;
}
</style>
