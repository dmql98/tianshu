<script setup lang="ts">
import { onMounted } from 'vue'
import { useFilesStore } from '@/stores/files'

const filesStore = useFilesStore()

onMounted(() => {
  filesStore.fetchEntries('')
})

function handleFileClick(entry: any) {
  if (entry.type === 'directory') {
    filesStore.fetchEntries(entry.path)
  }
}
</script>

<template>
  <div class="files-panel">
    <div class="panel-header">
      <span class="panel-title">文件</span>
      <div class="breadcrumb">
        <span>{{ filesStore.currentPath || '/' }}</span>
      </div>
    </div>
    <div class="file-list">
      <div v-if="filesStore.loading" class="loading">加载中...</div>
      <div
        v-for="entry in filesStore.entries"
        :key="entry.path"
        class="file-item"
        @click="handleFileClick(entry)"
      >
        <span class="file-icon">{{ entry.type === 'directory' ? '📁' : '📄' }}</span>
        <span class="file-name">{{ entry.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.files-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel-header {
  padding: 12px;
  border-bottom: 1px solid #e0e0e0;
}
.panel-title {
  font-weight: 600;
  font-size: 14px;
}
.breadcrumb {
  font-size: 12px;
  color: #666;
  margin-top: 4px;
}
.file-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.loading {
  text-align: center;
  color: #999;
  padding: 20px;
}
.file-item {
  display: flex;
  align-items: center;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
}
.file-item:hover {
  background: #f0f0f0;
}
.file-icon {
  margin-right: 8px;
}
.file-name {
  font-size: 13px;
}
</style>
