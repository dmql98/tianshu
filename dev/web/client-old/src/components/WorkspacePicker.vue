<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { browseDirectory, resolvePath, type DirEntry } from '@/api/workspace'

const props = defineProps<{ selected?: string[] }>()
const emit = defineEmits<{ select: [paths: string[]]; close: [] }>()

const currentPath = ref('')
const parentPath = ref<string | null>(null)
const entries = ref<DirEntry[]>([])
const loading = ref(false)
const error = ref('')
const checked = ref(new Set<string>())
const manualPath = ref('')
const resolving = ref(false)
const manualError = ref('')

async function load(path?: string) {
  loading.value = true
  error.value = ''
  try {
    const result = await browseDirectory(path)
    currentPath.value = result.currentPath
    parentPath.value = result.parentPath
    entries.value = result.entries.filter(e => e.isDir)
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

function goUp() {
  if (parentPath.value) load(parentPath.value)
}

function enterDir(entry: DirEntry) {
  load(entry.path)
}

function toggleCheck(path: string) {
  if (checked.value.has(path)) {
    checked.value.delete(path)
  } else {
    checked.value.add(path)
  }
}

function confirmSelection() {
  const paths = Array.from(checked.value)
  if (paths.length > 0) emit('select', paths)
}

function selectCurrentDir() {
  if (currentPath.value) {
    emit('select', [currentPath.value])
  }
}

async function goToPath() {
  const p = manualPath.value.trim()
  if (!p) return
  manualError.value = ''
  if (p.includes('..')) { manualError.value = '路径不能包含 ..'; return }
  resolving.value = true
  try {
    const result = await resolvePath(p)
    if (result.path) {
      load(result.path)
    } else {
      manualError.value = '路径不存在'
    }
  } catch {
    manualError.value = '路径解析失败'
  } finally {
    resolving.value = false
  }
}

function handleManualKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') goToPath()
}

onMounted(() => load())
</script>

<template>
  <div class="picker-overlay" @click.self="$emit('close')">
    <div class="picker-dialog">
      <div class="picker-header">
        <h3>选择工作区目录</h3>
        <button class="close-btn" @click="$emit('close')">&times;</button>
      </div>

      <div class="picker-manual">
        <input
          v-model="manualPath"
          class="manual-input"
          placeholder="直接输入路径后按回车，如 C:\Users\..."
          @keydown="handleManualKeydown"
        />
        <button class="manual-go" :disabled="!manualPath.trim() || resolving" @click="goToPath">前往</button>
      </div>
      <div v-if="manualError" class="manual-error">{{ manualError }}</div>

      <div class="picker-nav">
        <button class="nav-btn" :disabled="!parentPath" @click="goUp">.. 上级</button>
        <span class="current-path">{{ currentPath || '快捷入口' }}</span>
        <button class="nav-btn add-current" :disabled="!currentPath" @click="selectCurrentDir">+ 添加当前</button>
      </div>

      <div class="picker-hint" v-if="props.selected && props.selected.length > 0">
        已有工作区: {{ props.selected.join(', ') }}
      </div>

      <div v-if="loading" class="picker-loading">加载中...</div>
      <div v-else-if="error" class="picker-error">{{ error }}</div>
      <div v-else class="picker-list">
        <div
          v-for="entry in entries"
          :key="entry.path"
          class="picker-item"
          :class="{ checked: checked.has(entry.path) }"
          @click="toggleCheck(entry.path)"
        >
          <input type="checkbox" :checked="checked.has(entry.path)" class="item-checkbox" />
          <span class="item-icon">📁</span>
          <span class="item-name">{{ entry.name }}</span>
          <span class="item-path">{{ currentPath ? entry.path : '' }}</span>
          <button class="enter-btn" @click.stop="enterDir(entry)" title="进入">▸</button>
        </div>
        <div v-if="entries.length === 0" class="picker-empty">空目录</div>
      </div>

      <div class="picker-footer">
        <button class="btn btn-cancel" @click="$emit('close')">取消</button>
        <span class="footer-count" v-if="checked.size > 0">已选 {{ checked.size }} 个目录</span>
        <button class="btn btn-confirm" :disabled="checked.size === 0" @click="confirmSelection">
          添加选中目录 ({{ checked.size }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.picker-dialog {
  background: white;
  border-radius: 12px;
  width: 600px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 8px;
}
.picker-header h3 { margin: 0; font-size: 16px; }
.close-btn {
  background: none; border: none; font-size: 22px; cursor: pointer;
  color: #888; padding: 0 4px;
}
.close-btn:hover { color: #333; }

.picker-manual {
  display: flex;
  gap: 6px;
  padding: 6px 20px 4px;
}
.manual-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.manual-input:focus { border-color: #007aff; }
.manual-go {
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: #007aff;
  color: white;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.manual-go:disabled { opacity: 0.5; cursor: default; }
.manual-go:hover:not(:disabled) { background: #0056b3; }
.manual-error {
  padding: 0 20px 4px;
  font-size: 12px;
  color: #d32f2f;
}

.picker-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border-bottom: 1px solid #eee;
}
.nav-btn {
  background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px;
  padding: 3px 8px; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.nav-btn:disabled { opacity: 0.4; cursor: default; }
.nav-btn:hover:not(:disabled) { background: #e0e0e0; }
.add-current { background: #e3f2fd; border-color: #90caf9; color: #1976d2; }
.add-current:hover:not(:disabled) { background: #bbdefb; }
.current-path {
  font-size: 12px; color: #666; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.picker-hint {
  padding: 4px 20px; font-size: 11px; color: #888;
  background: #fafafa; border-bottom: 1px solid #eee;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.picker-loading, .picker-error, .picker-empty {
  padding: 40px 20px; text-align: center; color: #888; font-size: 13px;
}
.picker-error { color: #d32f2f; }
.picker-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 20px;
  cursor: pointer;
  font-size: 13px;
}
.picker-item:hover { background: #f5f5f5; }
.picker-item.checked { background: #e3f2fd; }
.item-checkbox { margin: 0; flex-shrink: 0; }
.item-icon { font-size: 16px; flex-shrink: 0; }
.item-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.item-path {
  font-size: 11px; color: #999;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1;
}
.enter-btn {
  background: none; border: 1px solid #ccc; border-radius: 3px;
  padding: 1px 6px; font-size: 11px; cursor: pointer; color: #888;
  flex-shrink: 0;
}
.enter-btn:hover { background: #e0e0e0; color: #333; }
.picker-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid #eee;
}
.footer-count { font-size: 12px; color: #888; margin-right: auto; }
.btn {
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.btn-cancel { background: #f0f0f0; color: #333; }
.btn-cancel:hover { background: #e0e0e0; }
.btn-confirm { background: #007aff; color: white; }
.btn-confirm:disabled { opacity: 0.5; cursor: default; }
.btn-confirm:hover:not(:disabled) { background: #0056b3; }
</style>
