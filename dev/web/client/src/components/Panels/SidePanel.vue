<script setup lang="ts">
import { ref } from 'vue'
import FilesPanel from './FilesPanel.vue'
import OutlinePanel from './OutlinePanel.vue'

const activePanel = ref<'files' | 'outline'>('files')
</script>

<template>
  <div class="side-panel">
    <div class="panel-tabs">
      <button
        :class="{ active: activePanel === 'files' }"
        @click="activePanel = 'files'"
      >
        文件
      </button>
      <button
        :class="{ active: activePanel === 'outline' }"
        @click="activePanel = 'outline'"
      >
        大纲
      </button>
    </div>
    <div class="panel-content">
      <FilesPanel v-if="activePanel === 'files'" />
      <OutlinePanel v-else />
    </div>
  </div>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-left: 1px solid #e0e0e0;
}
.panel-tabs {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
}
.panel-tabs button {
  flex: 1;
  padding: 8px;
  border: none;
  background: #f8f9fa;
  cursor: pointer;
  font-size: 13px;
}
.panel-tabs button.active {
  background: white;
  border-bottom: 2px solid #007aff;
}
.panel-content {
  flex: 1;
  overflow: hidden;
}
</style>
