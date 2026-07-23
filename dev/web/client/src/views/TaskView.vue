<script setup lang="ts">
const columns = [
  { key: 'todo', label: '待开始' },
  { key: 'in_progress', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'abandoned', label: '已废弃' },
]
</script>

<template>
  <div class="task-page">
    <div class="task-columns">
      <div v-for="col in columns" :key="col.key" class="task-column">
        <div class="task-column-header">
          <span class="task-column-title">{{ col.label }}</span>
          <span class="task-column-count">0</span>
        </div>
        <div class="task-column-body">
          <div class="task-empty">暂无任务</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-page {
  flex: 1;
  padding: 24px 32px;
  overflow-x: auto;
  background: #f5f6f8;
}

.task-columns {
  display: flex;
  gap: 16px;
  min-height: 100%;
  align-items: flex-start;
}

.task-column {
  flex: 1;
  min-width: 220px;
  background: #fff;
  border-radius: 10px;
  border: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
  background: #fafafa;
}

.task-column-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.task-column-count {
  font-size: 12px;
  color: #999;
  background: #eee;
  border-radius: 10px;
  padding: 0 8px;
  line-height: 20px;
  min-width: 20px;
  text-align: center;
}

.task-column-body {
  flex: 1;
  padding: 12px;
  min-height: 200px;
}

.task-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 13px;
  color: #ccc;
}
</style>
