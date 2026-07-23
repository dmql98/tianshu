<script setup lang="ts">
defineProps<{
  label: string
  hint?: string
}>()
</script>

<template>
  <div class="setting-row">
    <div class="setting-info">
      <label class="setting-label">{{ label }}</label>
      <p v-if="hint" class="setting-hint">{{ hint }}</p>
    </div>
    <div class="setting-control">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-row:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 16px;
}

.setting-label {
  font-size: 13px;
  color: #333;
  display: block;
}

.setting-hint {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}

.setting-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
