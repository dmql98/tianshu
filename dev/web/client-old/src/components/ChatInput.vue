<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import type { Strategy } from '@/api/socket'
import InputToolbar from './Chat/InputToolbar.vue'

const chatStore = useChatStore()
const text = ref('')
const sending = ref(false)
const textareaRef = ref<HTMLTextAreaElement>()
const isEventSession = computed(() => chatStore.activeSession?.session_type === 'event')
const ctx = computed(() => chatStore.contextUsage)
const blockEventInterrupt = localStorage.getItem('blockEventInterrupt') === 'true'
const permitEventInput = ref(false)
function permitInput() { permitEventInput.value = true }
const inputDisabled = computed(() => isEventSession.value && blockEventInterrupt && !permitEventInput.value)

watch(() => chatStore.activeSessionId, () => { permitEventInput.value = false })

const commandStrategies: Record<string, Strategy> = {
  '/plan': 'Plan', '/ask': 'Ask', '/bypass': 'Bypass',
}

async function handleSubmit() {
  const input = text.value.trim()

  // No content + streaming → abort
  if (!input && chatStore.isStreaming) {
    chatStore.abortRun()
    return
  }
  // No content + idle → disabled (button does nothing)
  if (!input) return

  // Command → strategy.set
  const cmd = input.toLowerCase()
  if (cmd in commandStrategies) {
    chatStore.setStrategy(commandStrategies[cmd])
    text.value = ''
    resetHeight()
    return
  }

  // Normal message
  if (sending.value) return
  sending.value = true
  text.value = ''
  resetHeight()
  chatStore.sendMessage(input)
  setTimeout(() => { sending.value = false }, 500)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
}

let dragStartY = 0
let dragStartHeight = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  const el = textareaRef.value
  if (!el) return
  dragStartY = e.clientY
  dragStartHeight = el.offsetHeight
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const el = textareaRef.value
  if (!el) return
  const dh = dragStartY - e.clientY
  el.style.height = Math.max(40, Math.min(dragStartHeight + dh, 300)) + 'px'
  el.style.resize = 'none'
}

function onResizeEnd() {
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

function autoResize() {
  const el = textareaRef.value
  if (el && el.style.resize !== 'none') {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 300) + 'px'
  }
}

function resetHeight() {
  const el = textareaRef.value
  if (el) {
    el.style.height = ''
    el.style.resize = ''
  }
}
</script>

<template>
  <div class="chat-input-area">
    <InputToolbar />
    <div v-if="ctx.show" class="context-bar" :class="{ warn: ctx.pct > 70, danger: ctx.pct > 90, compacted: chatStore.activeSession?.compacted }">
      <div class="context-fill" :style="{ width: ctx.pct + '%' }"></div>
      <span class="context-label">{{ ctx.pct }}% ({{ (ctx.used / 1000).toFixed(0) }}K / {{ (ctx.total / 1000).toFixed(0) }}K tokens)</span>
      <span v-if="chatStore.activeSession?.compacted" class="compacted-badge">压缩</span>
    </div>
    <div class="input-row">
      <div class="textarea-wrap">
        <textarea
          ref="textareaRef"
          v-model="text"
          :placeholder="inputDisabled ? '⛔ 事件仅可查看，无法发送消息' : 'Type a message... (@file:path @url:URL @folder:path) (Shift+Enter for new line)'"
          rows="1"
          :disabled="inputDisabled"
          @keydown="onKeydown"
          @input="autoResize"
        />
        <div class="resize-handle" @mousedown="onResizeStart">⋮</div>
      </div>
      <div class="actions">
        <button
          class="btn"
          :class="chatStore.isStreaming ? 'abort' : 'send'"
          :disabled="inputDisabled || (!chatStore.isStreaming && !text.trim())"
          @click="handleSubmit"
        >{{ chatStore.isStreaming ? '■ Stop' : '发送' }}</button>
      </div>
    </div>
    <div class="input-hint">
      <span v-if="isEventSession && blockEventInterrupt && !permitEventInput">
        事件执行中 · 仅可查看
        <label class="unmute-link" @click="permitInput">允许打断</label>
      </span>
      <span v-else>Enter 发送 · Shift+Enter 换行</span>
    </div>
  </div>
</template>

<style scoped>
.chat-input-area { border-top: 1px solid #e0e0e0; }
.context-bar {
  position: relative; margin: 4px 12px 0; height: 18px;
  background: #e8e8e8; border-radius: 4px; overflow: hidden;
}
.context-fill {
  height: 100%; background: #007aff; border-radius: 4px;
  transition: width 0.3s ease; min-width: 0;
}
.context-bar.warn .context-fill { background: #ff9500; }
.context-bar.danger .context-fill { background: #ff3b30; }
.context-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #555; font-weight: 500; line-height: 18px;
}
.compacted-badge {
  position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
  font-size: 9px; background: #8b5cf6; color: #fff; padding: 1px 5px;
  border-radius: 3px; line-height: 14px; font-weight: 600;
}
.context-bar.compacted { border: 1px solid #8b5cf6; }
.input-row { display: flex; gap: 8px; padding: 8px 12px 4px; align-items: flex-end; }
.textarea-wrap { flex: 1; position: relative; }
textarea {
  width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 8px;
  font-size: 14px; resize: none; font-family: inherit; line-height: 1.4;
  min-height: 40px; max-height: 300px; box-sizing: border-box;
}
textarea:focus { outline: none; border-color: #007aff; }
textarea:disabled { background: #f5f5f5; cursor: not-allowed; }
.resize-handle {
  position: absolute; top: 2px; right: 6px;
  cursor: n-resize; font-size: 16px; color: #bbb; line-height: 1;
  user-select: none;
}
.resize-handle:hover { color: #666; }
.actions { display: flex; gap: 4px; }
.btn { padding: 10px 18px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; white-space: nowrap; }
.btn.send { background: #007aff; color: white; }
.btn.send:disabled { opacity: 0.5; cursor: default; }
.btn.abort { background: #ff3b30; color: white; }
.input-hint { padding: 0 12px 6px; font-size: 11px; color: #aaa; text-align: right; }
.unmute-link { color: #007aff; cursor: pointer; text-decoration: underline; margin-left: 4px; }
</style>
