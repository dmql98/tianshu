<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useCharactersStore } from '@/stores/characters'
import { useProvidersStore } from '@/stores/providers'
import { useChatStore } from '@/stores/chat'
import * as eventsApi from '@/api/events'
import type { EventRecord, CreateEventInput } from '@/api/events'
import { getSocket, type RunEvent } from '@/api/socket'
import { CronLight } from '@vue-js-cron/light'
import '@vue-js-cron/light/dist/light.css'

const router = useRouter()
const charactersStore = useCharactersStore()
const chatStore = useChatStore()
const events = ref<EventRecord[]>([])
const loading = ref(false)
const showCreate = ref(false)
const filterStatus = ref('')

const providersStore = useProvidersStore()

const form = ref<CreateEventInput & { model?: string; provider_id?: string; workspace?: string; thinking?: boolean; reasoning_effort?: string; assigned_group_id?: string; scheduled_at_str?: string; once_mode?: string }>({
  assigned_agent_id: '',
  type: 'once',
  payload: { instruction: '' },
  cron_expr: '',
  source_type: 'user',
  model: '',
  provider_id: '',
  workspace: '',
  thinking: false,
  reasoning_effort: '',
  assigned_group_id: '',
  scheduled_at_str: '',
  once_mode: 'immediate',
})

const createError = ref('')
const creating = ref(false)

const selectedProviderModels = computed(() => {
  if (!form.value.provider_id) return []
  const p = providersStore.providers.find(x => x.id === form.value.provider_id)
  return p?.models?.filter((m: any) => m.enabled !== false) || []
})

const selectedCharGroups = computed(() => {
  if (!form.value.assigned_agent_id) return []
  const c = charactersStore.characters.find(x => x.id === form.value.assigned_agent_id)
  return c?.groups?.filter(g => g.trim()) || []
})

const statusColors: Record<string, string> = {
  pending: '#f59e0b', running: '#3b82f6',
  completed: '#10b981', failed: '#ef4444', archived: '#6b7280',
}

const sourceColors: Record<string, string> = {
  user: '#3b82f6', agent: '#8b5cf6', system: '#6b7280',
}

const sourceLabels: Record<string, string> = {
  user: '用户', agent: 'Agent', system: '系统',
}

const typeLabels: Record<string, string> = {
  once: '一次性', cron: '定时',
}

onMounted(async () => {
  await charactersStore.load()
  loadEvents()
  getSocket().on('event:status_changed', onEventStatusChanged)
})

onUnmounted(() => {
  getSocket().off('event:status_changed', onEventStatusChanged)
})

function onEventStatusChanged(data: { eventId: string; status: string; result_summary?: string; error_log?: string }) {
  const evt = events.value.find(e => e.id === data.eventId)
  if (evt) {
    evt.status = data.status as EventRecord['status']
    if (data.result_summary) evt.result_summary = data.result_summary
    if (data.error_log) evt.error_log = data.error_log
  }
}

async function loadEvents() {
  loading.value = true
  try {
    events.value = await eventsApi.fetchEvents(filterStatus.value ? { status: filterStatus.value } : undefined)
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  createError.value = ''
  if (!form.value.assigned_agent_id) { createError.value = '请选择执行角色'; return }
  if (!form.value.payload.instruction.trim()) { createError.value = '请输入指令'; return }
  if (form.value.type === 'cron' && !form.value.cron_expr?.trim()) { createError.value = '请输入 Cron 表达式'; return }

  creating.value = true
  try {
    const scheduled_at = form.value.type === 'once' && form.value.once_mode === 'custom' && form.value.scheduled_at_str
      ? new Date(form.value.scheduled_at_str).getTime()
      : Date.now()

    const evt = await eventsApi.createEvent({
      assigned_agent_id: form.value.assigned_agent_id,
      assigned_group_id: form.value.assigned_group_id || undefined,
      model: form.value.model || undefined,
      provider_id: form.value.provider_id || undefined,
      workspace: form.value.workspace || undefined,
      type: form.value.type,
      cron_expr: form.value.cron_expr || undefined,
      source_type: 'user',
      payload: { instruction: form.value.payload.instruction.trim() },
      scheduled_at,
    })
    events.value.unshift(evt)
    showCreate.value = false
    resetForm()
  } catch (err: any) {
    createError.value = err.message
  } finally {
    creating.value = false
  }
}

function resetForm() {
  form.value = { assigned_agent_id: '', type: 'once', payload: { instruction: '' }, cron_expr: '', source_type: 'user', model: '', provider_id: '', workspace: '', thinking: false, reasoning_effort: '', assigned_group_id: '', scheduled_at_str: '', once_mode: 'immediate' }
  createError.value = ''
}

async function updateStatus(evt: EventRecord, status: string) {
  try {
    const updated = await eventsApi.updateEventStatus(evt.id, status)
    Object.assign(evt, updated)
  } catch (err: any) {
    console.error('Failed to update event status:', err)
  }
}

async function triggerEvent(evt: EventRecord) {
  const payload = typeof evt.payload === 'string' ? JSON.parse(evt.payload) : evt.payload
  const instruction = payload?.instruction || ''

  evt.status = 'running'
  try {
    await eventsApi.updateEventStatus(evt.id, 'running')
  } catch (err: any) {
    console.error('Failed to set event running:', err)
    return
  }

  const session = await chatStore.createSession({
    character_id: evt.assigned_agent_id,
    provider_id: evt.provider_id || undefined,
    model: evt.model || undefined,
    workspace: evt.workspace || undefined,
    session_type: 'event',
    event_id: evt.id,
    title: instruction.slice(0, 50),
  })
  chatStore.switchSession(session.id)

  await nextTick()
  chatStore.sendMessage(instruction)

  // Navigate to chat view so user sees streaming
  router.push(`/c/${session.id}`)

  const socket = getSocket()
  const trackCompleted = (data: RunEvent) => {
    if (data.session_id !== session.id) return
    socket.off('run.completed', trackCompleted)
    socket.off('run.failed', trackFailed)
    const newStatus = data.status === 'failed' ? 'failed' : 'completed'
    evt.status = newStatus
    eventsApi.updateEventStatus(evt.id, newStatus)
  }
  const trackFailed = (data: RunEvent) => {
    if (data.session_id !== session.id) return
    socket.off('run.completed', trackCompleted)
    socket.off('run.failed', trackFailed)
    evt.status = 'failed'
    eventsApi.updateEventStatus(evt.id, 'failed')
  }
  socket.on('run.completed', trackCompleted)
  socket.on('run.failed', trackFailed)
}

async function retryEvent(evt: EventRecord) {
  try {
    const updated = await eventsApi.updateEventStatus(evt.id, 'pending', { scheduled_at: Date.now() })
    Object.assign(evt, updated)
  } catch (err: any) {
    console.error('Failed to retry event:', err)
  }
}

function viewSession(evt: EventRecord) {
  router.push('/c')
}

async function archiveEventAction(evt: EventRecord) {
  try {
    await eventsApi.archiveEvent(evt.id)
    evt.status = 'archived'
  } catch (err: any) {
    console.error('Failed to archive event:', err)
  }
}

async function handleDelete(evt: EventRecord) {
  try {
    await eventsApi.deleteEvent(evt.id)
    events.value = events.value.filter(e => e.id !== evt.id)
  } catch (err: any) {
    console.error('Failed to delete event:', err)
  }
}

function payloadPreview(payload: string): string {
  try {
    const p = JSON.parse(payload)
    return p.instruction?.slice(0, 80) || payload.slice(0, 80)
  } catch {
    return payload.slice(0, 80)
  }
}

function fullPayload(payload: string): string {
  try {
    const p = JSON.parse(payload)
    return p.instruction || payload
  } catch {
    return payload
  }
}

function timeAgo(ts: number | null): string {
  if (!ts) return '-'
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return `${days}天前`
}

const availableChars = computed(() => charactersStore.characters)

const statusColumns = [
  { key: 'pending', label: '待处理' },
  { key: 'running', label: '运行中' },
  { key: 'completed', label: '完成' },
  { key: 'failed', label: '失败' },
  { key: 'archived', label: '已归档' },
]

const expandedCards = ref<Set<string>>(new Set())

function copyId(id: string) {
  navigator.clipboard.writeText(id)
}

function toggleExpand(id: string) {
  if (expandedCards.value.has(id)) {
    expandedCards.value.delete(id)
  } else {
    expandedCards.value.add(id)
  }
}

const groupedByStatus = computed(() => {
  const map: Record<string, EventRecord[]> = {}
  for (const col of statusColumns) map[col.key] = []
  for (const evt of events.value) {
    if (map[evt.status]) map[evt.status].push(evt)
  }
  return map
})
</script>

<template>
  <div class="events-view">
    <div class="page-header">
      <h1>事件中心</h1>
      <div class="header-actions">
          <select v-model="filterStatus" class="filter-select" @change="loadEvents">
          <option value="">全部状态</option>
          <option value="pending">待处理</option>
          <option value="running">运行中</option>
          <option value="completed">完成</option>
          <option value="failed">失败</option>
          <option value="archived">已归档</option>
        </select>
        <button class="btn btn-primary" @click="showCreate = true">+ 新建事件</button>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="events.length === 0" class="empty">
      <p>暂无事件</p>
    </div>

    <div v-else class="event-columns">
      <div v-for="col in statusColumns" :key="col.key" class="event-column">
        <div class="event-column-header" :style="{ borderColor: statusColors[col.key] || '#999' }">
          <span class="event-column-title">
            <span class="status-dot" :style="{ background: statusColors[col.key] || '#999' }"></span>
            {{ col.label }}
          </span>
          <span class="event-column-count">{{ groupedByStatus[col.key]?.length || 0 }}</span>
        </div>
        <div class="event-column-body">
          <div v-for="evt in groupedByStatus[col.key]" :key="evt.id" class="event-card" :class="{ expanded: expandedCards.has(evt.id) }">
            <div class="card-header">
              <span class="source-tag" :style="{ background: sourceColors[evt.source_type] || '#999' }">
                {{ sourceLabels[evt.source_type] || evt.source_type }}
              </span>
              <span class="type-tag">{{ typeLabels[evt.type] || evt.type }}</span>
              <button class="btn-expand" @click="toggleExpand(evt.id)">{{ expandedCards.has(evt.id) ? '收起' : '展开' }}</button>
            </div>
            <div :class="['card-payload', { 'card-payload-expanded': expandedCards.has(evt.id) }]">
              {{ expandedCards.has(evt.id) ? fullPayload(evt.payload) : payloadPreview(evt.payload) }}
            </div>
            <div class="card-meta">
              <span class="agent-cell">{{ evt.assigned_agent_id }}</span>
              <span class="time-cell">{{ timeAgo(evt.created_at) }}</span>
              <button class="btn-copy-id" @click="copyId(evt.id)" title="复制事件 ID">复制 ID</button>
            </div>
            <div v-if="evt.result_summary && evt.status !== 'failed'" class="card-summary">
              {{ expandedCards.has(evt.id) ? evt.result_summary : evt.result_summary.slice(0, 60) }}
            </div>
            <div v-if="evt.status === 'failed' && evt.error_log" class="card-error">
              {{ expandedCards.has(evt.id) ? evt.error_log : evt.error_log.slice(0, 120) }}
            </div>
            <div class="card-actions">
              <button
                v-if="evt.status === 'pending'"
                class="btn btn-sm btn-primary"
                @click="triggerEvent(evt)"
                title="立即触发"
              >▶ 触发</button>
              <button
                v-if="evt.status === 'pending'"
                class="btn btn-sm btn-danger"
                @click="handleDelete(evt)"
                title="放弃"
              >放弃</button>
              <button
                v-if="evt.status === 'failed'"
                class="btn btn-sm"
                @click="retryEvent(evt)"
                title="重试"
              >重试</button>
              <button
                v-if="evt.status === 'running'"
                class="btn btn-sm"
                @click="viewSession(evt)"
                title="查看会话"
              >查看</button>
              <button
                v-if="evt.status === 'completed' || evt.status === 'failed'"
                class="btn btn-sm"
                @click="archiveEventAction(evt)"
                title="归档"
              >归档</button>
            </div>
          </div>
          <div v-if="!groupedByStatus[col.key]?.length" class="event-empty">暂无</div>
        </div>
      </div>
    </div>

    <!-- Create Event Modal -->
    <Teleport to="body">
      <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
        <div class="modal event-modal">
          <h2>新建事件</h2>
          <div class="event-form">
            <div class="form-config">
              <div class="form-group">
                <label>执行角色</label>
                <select v-model="form.assigned_agent_id">
                  <option value="" disabled>请选择...</option>
                  <option v-for="c in availableChars" :key="c.id" :value="c.id">
                    {{ c.name }} ({{ c.id }})
                  </option>
                </select>
              </div>
              <div class="form-group">
                <label>分组</label>
                <select v-model="form.assigned_group_id" :disabled="selectedCharGroups.length === 0">
                  <option value="">无</option>
                  <option v-for="g in selectedCharGroups" :key="g" :value="g">{{ g }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>提供商</label>
                <select v-model="form.provider_id">
                  <option value="">默认</option>
                  <option v-for="p in providersStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>模型</label>
                <select v-model="form.model" :disabled="!form.provider_id">
                  <option value="">默认</option>
                  <option v-for="m in selectedProviderModels" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
                </select>
              </div>
              <div class="form-group thinking-inline">
                <label class="thinking-label">
                  <input type="checkbox" v-model="form.thinking" />
                  思考模式
                </label>
                <select v-if="form.thinking" v-model="form.reasoning_effort">
                  <option value="">默认</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="max">最高</option>
                </select>
              </div>
              <div class="form-group">
                <label>工作区</label>
                <div class="workspace-row">
                  <input v-model="form.workspace" placeholder="工作目录路径" />
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>指令</label>
              <textarea v-model="form.payload.instruction" rows="4" placeholder="描述要执行的任务..." />
            </div>
            <div class="form-bottom">
              <div class="form-group">
                <label>类型</label>
                <select v-model="form.type">
                  <option value="once">一次性</option>
                  <option value="cron">定时 (Cron)</option>
                </select>
              </div>
            </div>
            <div v-if="form.type === 'once'" class="once-schedule">
              <div class="once-mode-toggle">
                <button class="mode-btn" :class="{ active: form.once_mode === 'immediate' }" @click="form.once_mode = 'immediate'">立即</button>
                <button class="mode-btn" :class="{ active: form.once_mode === 'custom' }" @click="form.once_mode = 'custom'">定制</button>
              </div>
              <div v-if="form.once_mode === 'custom'" class="form-group">
                <label>预约时间</label>
                <input type="datetime-local" v-model="form.scheduled_at_str" />
              </div>
            </div>
            <div v-if="form.type === 'cron'" class="cron-editor-wrapper">
              <label>Cron 表达式</label>
              <CronLight v-model="form.cron_expr" locale="cn" format="crontab" theme="ant" />
            </div>
          </div>
          <p v-if="createError" class="error">{{ createError }}</p>
          <div class="modal-actions">
            <button class="btn" :disabled="creating" @click="showCreate = false">取消</button>
            <button class="btn btn-primary" :disabled="creating" @click="handleCreate">
              {{ creating ? '创建中...' : '创建' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.events-view { flex: 1; padding: 24px 32px; overflow-x: auto; background: #f5f6f8; display: flex; flex-direction: column; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-shrink: 0; }
.page-header h1 { font-size: 22px; font-weight: 600; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.filter-select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }
.btn { padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px; cursor: pointer; font-size: 13px; background: #fff; }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn-primary { background: #007aff; color: #fff; border-color: #007aff; }
.btn-danger { color: #ef4444; border-color: #ef4444; }
.btn-sm { padding: 4px 8px; font-size: 12px; line-height: 1.4; }
.loading, .empty { text-align: center; padding: 60px 0; color: #888; flex: 1; }

.event-columns { display: flex; gap: 16px; align-items: flex-start; flex: 1; min-height: 0; }
.event-column {
  flex: 1; min-width: 240px; background: #fff; border-radius: 10px;
  border: 1px solid #e0e0e0; display: flex; flex-direction: column; overflow: hidden;
}
.event-column-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid #eee; background: #fafafa;
  border-left: 3px solid;
}
.event-column-title { font-size: 14px; font-weight: 600; color: #333; display: flex; align-items: center; gap: 6px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.event-column-count {
  font-size: 12px; color: #666; background: #eee; border-radius: 10px;
  padding: 0 8px; line-height: 20px; min-width: 20px; text-align: center;
}
.event-column-body { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 120px; }

.event-card {
  border: 1px solid #e8e8e8; border-radius: 8px; padding: 10px 12px;
  background: #fff; font-size: 13px; display: flex; flex-direction: column; gap: 6px;
}
.event-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.event-card.expanded { border-color: #b0b0b0; background: #fcfcfc; }
.card-header { display: flex; align-items: center; gap: 6px; }
.btn-expand { margin-left: auto; font-size: 11px; color: #007aff; background: none; border: none; cursor: pointer; padding: 2px 4px; }
.btn-expand:hover { text-decoration: underline; }
.source-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; color: #fff; font-size: 11px; font-weight: 500; }
.type-tag { font-size: 11px; color: #666; background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
.card-payload {
  font-size: 13px; line-height: 1.4; color: #333;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-payload-expanded {
  -webkit-line-clamp: unset; display: block; overflow: visible;
}
.card-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #888; }
.btn-copy-id { margin-left: auto; font-size: 11px; color: #888; background: none; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; padding: 1px 6px; line-height: 1.5; }
.btn-copy-id:hover { color: #333; border-color: #999; }
.agent-cell { font-family: monospace; font-size: 11px; }
.time-cell { font-size: 11px; }
.card-summary { font-size: 11px; color: #666; background: #f9f9f9; padding: 4px 6px; border-radius: 4px; line-height: 1.3; }
.card-error { font-size: 11px; color: #b71c1c; background: #ffebee; padding: 4px 6px; border-radius: 4px; line-height: 1.3; word-break: break-all; border: 1px solid #ffcdd2; }
.card-actions { display: flex; gap: 4px; flex-wrap: wrap; padding-top: 4px; border-top: 1px solid #f0f0f0; }
.card-actions .btn { font-size: 11px; padding: 3px 6px; }
.event-empty { text-align: center; padding: 24px 0; font-size: 13px; color: #ccc; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: #fff; border-radius: 12px; padding: 24px; max-height: 90vh; overflow-y: auto; }
.event-modal { min-width: 520px; max-width: 560px; }
.event-modal h2 { margin-bottom: 16px; font-size: 18px; }
.event-form { display: flex; flex-direction: column; gap: 12px; }
.form-config { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-config .form-group:nth-child(5),
.form-config .form-group:nth-child(6) { grid-column: 1 / -1; }
.form-group { display: flex; flex-direction: column; gap: 4px; }
.form-group label { font-size: 12px; color: #555; font-weight: 500; }
.form-group select, .form-group input, .form-group textarea { width: 100%; padding: 7px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; font-family: inherit; box-sizing: border-box; }
.form-group select:disabled { background: #f5f5f5; cursor: not-allowed; }
.thinking-inline { flex-direction: row !important; align-items: center; gap: 10px; flex-wrap: wrap; }
.thinking-inline .thinking-label { display: flex !important; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; white-space: nowrap; flex-direction: row !important; margin-bottom: 0; }
.thinking-inline .thinking-label input[type="checkbox"] { margin: 0; }
.thinking-inline select { width: auto; min-width: 80px; }
.form-group textarea { resize: vertical; min-height: 80px; }
.form-group select:focus, .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #007aff; }
.workspace-row { display: flex; gap: 4px; }
.workspace-row input { flex: 1; }
.form-bottom { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.form-bottom .form-group { flex: 1; min-width: 120px; }
.cron-editor-wrapper { display: flex; flex-direction: column; gap: 4px; }
.cron-editor-wrapper > label { font-size: 12px; color: #555; font-weight: 500; }
.once-schedule { display: flex; flex-direction: column; gap: 8px; }
.once-mode-toggle { display: flex; gap: 8px; }
.mode-btn { padding: 4px 16px; border: 1px solid #ccc; border-radius: 6px; cursor: pointer; font-size: 13px; background: #fff; color: #555; }
.mode-btn.active { background: #007aff; color: #fff; border-color: #007aff; }
.mode-btn:not(.active):hover { border-color: #007aff; color: #007aff; }

.error { color: #ef4444; font-size: 12px; margin: 4px 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
