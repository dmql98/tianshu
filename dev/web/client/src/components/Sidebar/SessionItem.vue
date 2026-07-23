<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import ContextMenu from './ContextMenu.vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{
  session: {
    id: string
    title: string
    pinned?: boolean
    parent_id?: string
  }
  active: boolean
  depth?: number
}>()

const emit = defineEmits<{
  click: []
  contextmenu: [event: MouseEvent]
}>()

const router = useRouter()
const chatStore = useChatStore()
const showContextMenu = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
const expanded = ref(true)

function handleContextMenu(event: MouseEvent) {
  contextMenuPos.value = { x: event.clientX, y: event.clientY }
  showContextMenu.value = true
  emit('contextmenu', event)
}

function handleContextAction(action: string) {
  switch (action) {
    case 'delete':
      chatStore.deleteSingleSession(props.session.id)
      break
    case 'pin':
      chatStore.toggleSessionStar(props.session.id)
      break
    case 'rename':
      {
        const title = window.prompt('重命名会话', props.session.title)
        if (title && title !== props.session.title) {
          chatStore.renameSession(props.session.id, title)
        }
      }
      break
    case 'copy-id':
      navigator.clipboard.writeText(props.session.id)
      break
    case 'export':
      exportSession()
      break
  }
}

function exportSession() {
  const session = chatStore.sessions.find(s => s.id === props.session.id)
  if (!session) return
  const blob = new Blob([JSON.stringify({ id: session.id, title: session.title, messages: session.messages, workspace: session.workspace, model: session.model }, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${session.title || 'session'}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function toggleStar(event: MouseEvent) {
  event.stopPropagation()
  chatStore.toggleSessionStar(props.session.id)
}

function toggleExpand(event: MouseEvent) {
  event.stopPropagation()
  expanded.value = !expanded.value
}

const children = computed(() => {
  if (!props.session.parent_id) return chatStore.getChildSessions(props.session.id)
  return []
})

</script>

<template>
  <div class="session-wrapper">
    <div
      class="session-item"
      :class="{ active, selected: chatStore.selectedSessionIds.has(session.id), 'batch-mode': chatStore.isBatchMode, child: depth && depth > 0 }"
      :style="{ paddingLeft: (depth || 0) * 16 + 8 + 'px' }"
      @click="chatStore.isBatchMode ? chatStore.toggleSessionSelection(session.id) : emit('click')"
      @contextmenu.prevent="handleContextMenu"
    >
      <span
        v-if="!session.parent_id && children.length > 0"
        class="expand-btn"
        @click="toggleExpand"
      >{{ expanded ? '▾' : '▸' }}</span>
      <span v-else-if="session.parent_id" class="indent-marker">└</span>
      <input
        v-if="chatStore.isBatchMode"
        type="checkbox"
        class="session-checkbox"
        :checked="chatStore.selectedSessionIds.has(session.id)"
        @click.stop="chatStore.toggleSessionSelection(session.id)"
      />
      <span v-if="(session as any).session_type === 'event'" class="event-icon" title="事件会话">⚡</span>
      <span class="star-btn" :class="{ starred: session.pinned }" @click="toggleStar">
        {{ session.pinned ? '⭐' : '☆' }}
      </span>
      <span class="session-title">{{ session.title || (session.parent_id ? '子任务' : '新建对话') }}</span>
    </div>

    <div v-if="!session.parent_id && children.length > 0 && expanded" class="child-list">
      <SessionItem
        v-for="child in children"
        :key="child.id"
        :session="child"
        :active="child.id === chatStore.activeSessionId"
        :depth="(depth || 0) + 1"
        @click="router.push('/c/' + child.id)"
      />
    </div>
  </div>

  <ContextMenu
    :visible="showContextMenu"
    :x="contextMenuPos.x"
    :y="contextMenuPos.y"
    :session-id="session.id"
    :pinned="session.pinned ?? false"
    @close="showContextMenu = false"
    @action="handleContextAction"
  />
</template>

<style scoped>
.session-wrapper {
  position: relative;
}
.session-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  margin-bottom: 1px;
}
.session-item:hover {
  background: #e9ecef;
}
.session-item.active {
  background: #d0ebff;
  font-weight: 500;
}
.session-item.selected {
  background: #cce5ff;
}
.session-item.batch-mode {
  user-select: none;
}
.session-item.child {
  font-size: 12px;
  opacity: 0.85;
}
.expand-btn {
  width: 14px;
  font-size: 10px;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.indent-marker {
  width: 14px;
  font-size: 10px;
  color: #999;
  flex-shrink: 0;
}
.session-checkbox {
  margin-right: 6px;
  cursor: pointer;
}
.star-btn {
  margin-right: 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  user-select: none;
}
.star-btn.starred {
  font-size: 14px;
}
.session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.child-list {
  border-left: 1px solid #ddd;
  margin-left: 12px;
  padding-left: 4px;
}
</style>
