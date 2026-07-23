<script setup lang="ts">
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

interface OutlineItem {
  id: string
  type: 'user' | 'heading'
  content: string
  level?: number
  messageId: string
}

const outlineItems = computed<OutlineItem[]>(() => {
  const items: OutlineItem[] = []
  const messages = chatStore.activeSession?.messages || []
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    
    if (msg.role === 'user') {
      items.push({
        id: `user-${msg.id}`,
        type: 'user',
        content: msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : ''),
        messageId: msg.id,
      })
    }
    
    if (msg.role === 'assistant') {
      const headings = extractHeadings(msg.content, msg.id)
      items.push(...headings)
    }
  }
  
  return items
})

function extractHeadings(text: string, messageId: string): OutlineItem[] {
  const items: OutlineItem[] = []
  const regex = /^(#{1,3})\s+(.+)$/gm
  let match
  
  while ((match = regex.exec(text)) !== null) {
    items.push({
      id: `heading-${messageId}-${match.index}`,
      type: 'heading',
      content: match[2],
      level: match[1].length,
      messageId,
    })
  }
  
  return items
}

function scrollToItem(item: OutlineItem) {
  const element = document.getElementById(`msg-${item.messageId}`)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
  }
}
</script>

<template>
  <div class="outline-panel">
    <div class="panel-header">
      <span class="panel-title">大纲</span>
    </div>
    <div class="outline-list">
      <div
        v-for="item in outlineItems"
        :key="item.id"
        class="outline-item"
        :class="{ heading: item.type === 'heading' }"
        :style="{ paddingLeft: item.level ? `${(item.level - 1) * 16 + 8}px` : '8px' }"
        @click="scrollToItem(item)"
      >
        {{ item.content }}
      </div>
      <div v-if="outlineItems.length === 0" class="empty-state">
        暂无大纲内容
      </div>
    </div>
  </div>
</template>

<style scoped>
.outline-panel {
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
.outline-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.outline-item {
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.outline-item:hover {
  background: #f0f0f0;
}
.outline-item.heading {
  font-weight: 500;
}
.empty-state {
  text-align: center;
  color: #999;
  padding: 20px;
  font-size: 13px;
}
</style>
