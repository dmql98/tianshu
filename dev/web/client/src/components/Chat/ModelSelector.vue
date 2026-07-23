<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProvidersStore } from '@/stores/providers'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()
const chatStore = useChatStore()
const providersStore = useProvidersStore()

const open = ref(false)
const search = ref('')
const dropdownRef = ref<HTMLElement>()

const session = computed(() => chatStore.activeSession)

const groups = computed(() => {
  const q = search.value.toLowerCase()
  return providersStore.providers
    .map(p => ({
      provider: p,
      models: (p.models || []).filter((m: any) => m.enabled !== false && (!q || m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q))),
      matchProvider: !q || p.name.toLowerCase().includes(q),
    }))
    .filter(g => g.matchProvider || g.models.length > 0)
})

const currentLabel = computed(() => {
  const s = session.value
  if (!s) return t('chat.selectModel')
  if (s.model) {
    for (const p of providersStore.providers) {
      const m = (p.models || []).find((x: any) => x.id === s.model || x.name === s.model)
      if (m) return `${p.name} / ${m.name || m.id}`
    }
    return s.model
  }
  return t('chat.default')
})

function selectModel(providerId: string, modelId: string) {
  const s = session.value
  if (!s) return
  s.provider_id = providerId
  s.model = modelId
  open.value = false
  search.value = ''
}

function toggle() {
  open.value = !open.value
  if (open.value) search.value = ''
}

function onClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div ref="dropdownRef" class="model-selector">
    <button class="selector-trigger" @click.stop="toggle">
      <span class="trigger-label">{{ currentLabel }}</span>
      <span class="trigger-arrow" :class="{ up: open }">▾</span>
    </button>
    <div v-if="open" class="selector-dropdown">
      <div class="search-wrap">
        <input
          v-model="search"
          class="search-input"
          :placeholder="t('chat.searchModel')"
          @click.stop
        />
      </div>
      <div class="dropdown-list">
        <div
          v-for="g in groups"
          :key="g.provider.id"
          class="provider-group"
        >
          <div class="provider-head">
            <span class="head-icon">*</span>
            <span class="head-name">{{ g.provider.name }}</span>
          </div>
          <div class="model-list">
            <button
              v-for="m in g.models"
              :key="m.id"
              class="model-btn"
              :class="{ active: session?.provider_id === g.provider.id && session?.model === m.id }"
              @click="selectModel(g.provider.id, m.id)"
            >
              <span class="model-prefix">-</span>
              <span class="model-name">{{ m.name || m.id }}</span>
            </button>
          </div>
        </div>
        <div v-if="groups.length === 0" class="empty-hint">
          {{ t('chat.noModels') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-selector {
  position: relative;
}

.selector-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 12px;
  color: #333;
  max-width: 200px;
  white-space: nowrap;
}

.selector-trigger:hover {
  border-color: #007aff;
}

.trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-arrow {
  font-size: 10px;
  color: #999;
  transition: transform 0.15s;
}

.trigger-arrow.up {
  transform: rotate(180deg);
}

.selector-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  width: 280px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.12);
  z-index: 300;
  overflow: hidden;
}

.search-wrap {
  padding: 8px;
  border-bottom: 1px solid #eee;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
  box-sizing: border-box;
}

.search-input:focus {
  border-color: #007aff;
}

.dropdown-list {
  max-height: 300px;
  overflow-y: auto;
}

.provider-group + .provider-group {
  border-top: 1px solid #f0f0f0;
}

.provider-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  font-size: 12px;
  color: #666;
}

.head-icon {
  font-family: monospace;
  font-weight: bold;
  color: #999;
}

.head-name {
  font-weight: 600;
  color: #333;
}

.model-list {
  padding: 0 0 4px;
}

.model-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px 6px 24px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: #444;
  text-align: left;
}

.model-btn:hover {
  background: #f0f7ff;
}

.model-btn.active {
  background: #e3f2fd;
  color: #007aff;
  font-weight: 500;
}

.model-prefix {
  color: #bbb;
  font-family: monospace;
}

.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-hint {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: #999;
}
</style>
