<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import CopyButton from './CopyButton.vue'
import ToolDetail from './ToolDetail.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import MarkdownRenderer from './Markdown/MarkdownRenderer.vue'

const props = defineProps<{ message: import('@/stores/chat').Message }>()
const chatStore = useChatStore()

function resetHere() {
  const s = chatStore.activeSession
  if (s) chatStore.resetToMessage(s.id, props.message.id)
}
</script>

<template>
  <div :id="`msg-${message.id}`" class="message" :class="message.role">
    <div class="bubble">
      <ThinkingBlock
        v-if="message.reasoning"
        :content="message.reasoning"
        :duration="message.reasoning_duration"
      />
      <div v-if="message.role === 'tool'" class="tool-message">
        <ToolDetail
          :tool-name="message.tool_name || ''"
          :tool-input="message.tool_input"
          :tool-output="message.tool_output"
          :status="message.tool_status || 'running'"
        />
      </div>
      <div v-else class="text-content">
        <div v-if="message.attachments && message.attachments.length" class="msg-attachments">
          <template v-for="(a, i) in message.attachments" :key="i">
            <img v-if="a.dataUrl" :src="a.dataUrl" class="msg-attach-thumb" :alt="a.name" />
            <div v-else class="msg-attach-file">
              <span class="msg-attach-icon">📎</span>
              <span class="msg-attach-name">{{ a.name }}</span>
            </div>
          </template>
        </div>
        <span v-if="message.is_streaming && !message.content" class="cursor-blink">▋</span>
        <MarkdownRenderer :content="message.content" />
        <span v-if="message.is_streaming && message.content" class="cursor-blink">▋</span>
      </div>
      <div v-if="message.role !== 'tool' && !message.is_streaming" class="message-footer">
        <span class="timestamp">{{ new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}</span>
        <button class="reset-btn" @click="resetHere">重置到此处</button>
        <CopyButton :text="message.content" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.message { margin-bottom: 12px; display: flex; }
.message.user { justify-content: flex-end; }
.message.assistant .bubble { background: #f0f0f0; }
.message.user .bubble { background: #007aff; color: white; }
.bubble { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
.tool-message { width: 100%; }
.msg-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.msg-attach-thumb { max-width: 200px; max-height: 200px; border-radius: 8px; object-fit: cover; display: block; }
.msg-attach-file { display: inline-flex; align-items: center; gap: 4px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; padding: 4px 8px; font-size: 12px; max-width: 220px; }
.message.assistant .msg-attach-file { background: #e8e8e8; border-color: #ccc; }
.msg-attach-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cursor-blink { animation: blink 1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
.message-footer { margin-top: 6px; display: flex; align-items: center; gap: 6px; }
.message-footer .timestamp { font-size: 11px; color: #999; }
.message.user .message-footer .timestamp { color: rgba(255,255,255,0.7); }
.reset-btn { background: none; border: 1px solid #ccc; border-radius: 4px; padding: 2px 6px; cursor: pointer; font-size: 11px; color: #999; white-space: nowrap; }
.reset-btn:hover { border-color: #007aff; color: #007aff; }
</style>
