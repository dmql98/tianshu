<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import ModelSelector from './ModelSelector.vue'
import CharacterSelector from './CharacterSelector.vue'
import StrategyToggle from './StrategyToggle.vue'
import WorkspacePicker from '../WorkspacePicker.vue'

const { t } = useI18n()
const chatStore = useChatStore()

const session = computed(() => chatStore.activeSession)
const fileInput = ref<HTMLInputElement>()
const showWorkspacePicker = ref(false)

const workspaceList = computed(() => {
  const s = session.value
  if (!s) return []
  return s.workspaces && s.workspaces.length > 0
    ? s.workspaces
    : s.workspace ? [s.workspace] : []
})

function shortenPath(p: string, maxLen = 30): string {
  if (p.length <= maxLen) return p
  const parts = p.split(/[/\\]/)
  const last = parts.pop() || ''
  const prefix = '.../'
  let result = last
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts[i] + '/' + result
    if (prefix.length + candidate.length > maxLen) break
    result = candidate
  }
  return prefix + result
}

async function triggerDirPicker() {
  showWorkspacePicker.value = true
}

function onWorkspacePicked(paths: string[]) {
  const s = session.value
  if (!s) return
  for (const p of paths) {
    chatStore.addWorkspace(p)
  }
  if (!s.workspace && paths.length > 0) {
    s.workspace = paths[0]
  }
  showWorkspacePicker.value = false
}

function toggleThinking() {
  const s = session.value
  if (s) {
    s.thinking = !s.thinking
    if (!s.thinking) s.reasoning_effort = undefined
  }
}
function onReasoningEffortChange(e: Event) {
  const s = session.value
  if (s) s.reasoning_effort = (e.target as HTMLSelectElement).value || undefined
}
function triggerFilePicker() { fileInput.value?.click() }
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(binary)
}

function mimeFromExt(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return null
  const map: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', json: 'application/json',
    xml: 'application/xml', csv: 'text/csv', yaml: 'application/x-yaml', yml: 'application/x-yaml',
    toml: 'application/toml', js: 'application/javascript', ts: 'application/typescript',
    py: 'text/x-python', sh: 'text/x-shellscript', html: 'text/html', htm: 'text/html',
    css: 'text/css', log: 'text/plain', env: 'text/plain', ini: 'text/plain',
    cfg: 'text/plain', conf: 'text/plain',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon',
    pdf: 'application/pdf',
  }
  return map[ext] ?? null
}
function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    const mime = file.type || mimeFromExt(file.name) || 'application/octet-stream'
    if (mime.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const base64 = result.includes(',') ? result.split(',', 2)[1] : result
        chatStore.addAttachment(file.name, mime, base64, result)
      }
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer
        chatStore.addAttachment(file.name, mime, arrayBufferToBase64(buffer))
      }
      reader.readAsArrayBuffer(file)
    }
  }
  input.value = ''
}
</script>

<template>
  <div v-if="session" class="input-toolbar">
    <div class="toolbar-row top-row">
      <div class="config-group">
        <CharacterSelector />
        <span class="sep" />
        <ModelSelector />
      </div>
      <div class="config-group">
        <StrategyToggle />
      </div>

      <span class="spacer" />

      <div class="action-group">
        <label v-if="session.thinking" class="effort-select">
          <span class="effort-label">{{ t('chat.reasoningEffort') }}</span>
          <select :value="session.reasoning_effort || ''" @change="onReasoningEffortChange">
            <option value="">{{ t('chat.default') }}</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
            <option value="max">最高</option>
          </select>
        </label>
        <button class="icon-btn thinking-btn" :class="{ active: session.thinking }" @click="toggleThinking" title="思考模式">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V18a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z"/><path d="M9 22h6"/></svg>
          {{ t('chat.thinking') }}
        </button>
        <button class="icon-btn tool-toggle-btn" @click="chatStore.toggleAllTools()" :title="chatStore.toolExpandAll ? '折叠全部工具' : '展开全部工具'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          {{ chatStore.toolExpandAll ? '折叠' : '展开' }}
        </button>
      </div>
    </div>

    <div class="toolbar-row bottom-row">
      <div class="workspace-group">
        <span class="group-label">工作区</span>
        <div class="ws-chips">
          <span v-for="ws in workspaceList" :key="ws" class="ws-chip" :class="{ 'ws-chip-default': ws === session?.workspace }" :title="ws">
            <span class="ws-chip-name">{{ shortenPath(ws) }}</span>
            <span v-if="ws !== session?.workspace" class="ws-chip-remove" @click="chatStore.removeWorkspace(ws)">&times;</span>
          </span>
          <button class="ws-add-btn" @click="triggerDirPicker" title="添加工作区">+</button>
          <WorkspacePicker v-if="showWorkspacePicker" :selected="workspaceList" @select="onWorkspacePicked" @close="showWorkspacePicker = false" />
        </div>
      </div>

      <button class="icon-btn attach-btn" @click="triggerFilePicker" title="附加文件">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
        附加
      </button>
      <input ref="fileInput" type="file" multiple hidden @change="onFilePicked" />

      <div v-if="chatStore.attachments.length > 0" class="attach-chips">
        <span v-for="(a, i) in chatStore.attachments" :key="i" class="attach-chip">
          <img v-if="a.dataUrl" :src="a.dataUrl" class="attach-chip-thumb" />
          <span class="attach-chip-name">{{ a.name }}</span>
          <span class="attach-chip-remove" @click="chatStore.removeAttachment(i)">&times;</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-toolbar {
  border-bottom: 1px solid #e0e0e0;
  background: #fafafa;
  padding: 4px 12px;
}
.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.top-row {
  border-bottom: 1px solid #eee;
  padding-bottom: 4px;
  margin-bottom: 4px;
}
.config-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sep {
  width: 1px;
  height: 16px;
  background: #ddd;
  flex-shrink: 0;
}
.spacer { flex: 1; }
.action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Icon buttons */
.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: 1px solid #d0d0d0;
  border-radius: 5px;
  background: white;
  cursor: pointer;
  font-size: 11px;
  color: #666;
  white-space: nowrap;
  transition: all 0.15s;
}
.icon-btn:hover {
  border-color: #1976d2;
  color: #1976d2;
  background: #f5f9ff;
}
.icon-btn.active {
  background: #e8f4ff;
  border-color: #007aff;
  color: #007aff;
}

/* Effort select */
.effort-select {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #888;
}
.effort-label { white-space: nowrap; }
.effort-select select {
  font-size: 11px;
  padding: 2px 4px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  background: white;
  color: #555;
}

/* Workspace group */
.workspace-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.group-label {
  font-size: 11px;
  color: #999;
  white-space: nowrap;
  flex-shrink: 0;
}
.ws-chips {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
  min-width: 0;
}
.ws-chips::-webkit-scrollbar { height: 2px; }
.ws-chips::-webkit-scrollbar-thumb { background: #ccc; border-radius: 2px; }
.ws-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 5px 1px 6px;
  font-size: 11px;
  background: #eef2ff;
  color: #4f46e5;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: default;
  border: 1px solid #e0e7ff;
}
.ws-chip-name {
  white-space: nowrap;
}
.ws-chip-remove {
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  color: #a5b4fc;
  flex-shrink: 0;
  margin-left: 1px;
}
.ws-chip-remove:hover { color: #ef4444; }
.ws-chip-default { background: #e8f5e9; color: #2e7d32; border-color: #c8e6c9; cursor: default; }
.ws-chip-allowed { background: #fff3e0; color: #e65100; border-color: #ffe0b2; cursor: default; }
.ws-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px dashed #d0d0d0;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
  font-size: 13px;
  color: #aaa;
  flex-shrink: 0;
  line-height: 1.3;
}
.ws-add-btn:hover {
  border-color: #4f46e5;
  color: #4f46e5;
}

/* Attach button & chips */
.attach-btn {
  flex-shrink: 0;
}
.attach-chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  align-items: center;
  overflow-x: auto;
  min-width: 0;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px 5px 1px 3px;
  font-size: 11px;
  background: #f0fdf4;
  color: #16a34a;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
  border: 1px solid #dcfce7;
}
.attach-chip-thumb {
  width: 16px;
  height: 16px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
}
.attach-chip-name {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach-chip-remove {
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  color: #86efac;
  flex-shrink: 0;
  margin-left: 1px;
}
.attach-chip-remove:hover { color: #dc2626; }
</style>
