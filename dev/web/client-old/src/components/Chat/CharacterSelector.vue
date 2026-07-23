<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharactersStore } from '@/stores/characters'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()
const chatStore = useChatStore()
const charactersStore = useCharactersStore()

const open = ref(false)
const search = ref('')
const groupView = ref(false)

const session = computed(() => chatStore.activeSession)

const currentChar = computed(() => {
  const s = session.value
  if (!s) return null
  return charactersStore.characters.find(c => c.id === s.character_id) || null
})

const currentCharGroups = computed(() => {
  const c = currentChar.value
  return c?.groups?.filter(g => g.trim()) || []
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  return charactersStore.characters.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
  )
})

const grouped = computed(() => {
  const groups = new Map<string, typeof filtered.value>()
  const uncategorized: typeof filtered.value = []
  for (const c of filtered.value) {
    if (!c.groups || c.groups.length === 0) { uncategorized.push(c); continue }
    for (const grp of c.groups) {
      if (!groups.has(grp)) groups.set(grp, [])
      groups.get(grp)!.push(c)
    }
  }
  const result: { name: string; chars: typeof filtered.value }[] = []
  for (const [name, chars] of groups) {
    result.push({ name, chars })
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  if (uncategorized.length > 0) result.push({ name: 'Uncategorized', chars: uncategorized })
  return result
})

const currentLabel = computed(() => {
  const s = session.value
  if (!s) return t('chat.selectCharacter')
  const c = charactersStore.characters.find(x => x.id === s.character_id)
  const name = c?.name || s.character_id || t('chat.default')
  if (s.active_group) return `${name} [${s.active_group}]`
  return name
})

function select(id: string) {
  const s = session.value
  if (!s) return
  const c = charactersStore.characters.find(x => x.id === id)
  if (!c) return
  s.character_id = id
  s.active_group = undefined
  charactersStore.setActive(id)
  import('@/api/sessions').then(m => m.updateSession(s.id, { character_id: id, active_group: undefined })).catch(() => {})
  open.value = false
  search.value = ''
}

function isDisabled(role?: string) {
  return role === 'sub'
}
</script>

<template>
  <div class="selector">
    <button class="selector-trigger" @click="open = true">
      <span class="trigger-label">{{ currentLabel }}</span>
      <span class="trigger-arrow">▾</span>
    </button>

    <span v-if="currentCharGroups.length > 0" class="group-selector">
      <select v-model="session!.active_group">
        <option :value="undefined">none</option>
        <option v-for="g in currentCharGroups" :key="g" :value="g">{{ g }}</option>
      </select>
    </span>

    <Teleport to="body">
      <div v-if="open" class="modal-overlay" @click.self="open = false">
        <div class="modal-panel">
          <div class="modal-header">
            <span class="modal-title">{{ t('chat.selectCharacter') }}</span>
            <div class="modal-header-actions">
              <button class="group-toggle" :class="{ active: groupView }" @click="groupView = !groupView" title="Group view">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              </button>
              <button class="modal-close" @click="open = false">&times;</button>
            </div>
          </div>
          <div class="modal-search">
            <input v-model="search" class="search-input" :placeholder="t('chat.searchCharacter')" autofocus />
          </div>
          <div class="modal-list">
            <template v-if="groupView">
              <div v-for="grp in grouped" :key="grp.name" class="modal-group">
                <div class="modal-group-header">{{ grp.name }} <span class="modal-group-count">{{ grp.chars.length }}</span></div>
                <button
                  v-for="c in grp.chars"
                  :key="c.id"
                  class="modal-item"
                  :class="{ active: session?.character_id === c.id, disabled: isDisabled(c.role) }"
                  :disabled="isDisabled(c.role)"
                  @click="isDisabled(c.role) ? null : select(c.id)"
                >
                  <span class="modal-item-avatar" :style="{ borderColor: c.color || '#999' }">
                    <img v-if="c.avatar" :src="c.avatar" class="modal-item-avatar-img" />
                    <span v-else class="modal-item-avatar-letter">{{ c.name.charAt(0).toUpperCase() }}</span>
                  </span>
                  <span class="modal-item-info">
                    <span class="modal-item-name">{{ c.name }}</span>
                    <span class="modal-item-desc">{{ c.description || '' }}</span>
                  </span>
                  <span v-if="c.role === 'main' || c.role === 'both'" class="modal-item-badge main">main</span>
                  <span v-if="c.role === 'sub'" class="modal-item-badge sub">sub</span>
                  <span v-if="c.groups && c.groups.length > 1" class="modal-item-badge multi-group">multi</span>
                </button>
              </div>
            </template>
            <template v-else>
              <button
                v-for="c in filtered"
                :key="c.id"
                class="modal-item"
                :class="{ active: session?.character_id === c.id, disabled: isDisabled(c.role) }"
                :disabled="isDisabled(c.role)"
                @click="isDisabled(c.role) ? null : select(c.id)"
              >
                <span class="modal-item-avatar" :style="{ borderColor: c.color || '#999' }">
                  <img v-if="c.avatar" :src="c.avatar" class="modal-item-avatar-img" />
                  <span v-else class="modal-item-avatar-letter">{{ c.name.charAt(0).toUpperCase() }}</span>
                </span>
                <span class="modal-item-info">
                  <span class="modal-item-name">{{ c.name }}</span>
                  <span class="modal-item-desc">{{ c.description || '' }}</span>
                </span>
                <span v-if="c.role === 'main' || c.role === 'both'" class="modal-item-badge main">main</span>
                <span v-if="c.role === 'sub'" class="modal-item-badge sub">sub</span>
                <span v-if="c.groups && c.groups.length > 1" class="modal-item-badge multi-group">multi</span>
              </button>
            </template>
            <div v-if="filtered.length === 0" class="modal-empty">{{ t('chat.noCharacters') }}</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.selector { position: relative; display: inline-flex; align-items: center; gap: 6px; }

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
  max-width: 160px;
  white-space: nowrap;
}
.selector-trigger:hover { border-color: #007aff; }
.trigger-label { overflow: hidden; text-overflow: ellipsis; }
.trigger-arrow { font-size: 10px; color: #999; }

.group-selector select {
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  font-size: 12px;
  color: #333;
  cursor: pointer;
}
.group-selector select:hover { border-color: #007aff; }
</style>

<style>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal-panel {
  background: #fff;
  border-radius: 12px;
  width: 380px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.18);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}
.modal-title { font-size: 15px; font-weight: 600; color: #333; }
.modal-header-actions { display: flex; align-items: center; gap: 6px; }
.modal-header-actions .group-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  color: #888;
  padding: 0;
}
.modal-header-actions .group-toggle:hover { border-color: #1976d2; color: #1976d2; }
.modal-header-actions .group-toggle.active { background: #e3f2fd; border-color: #1976d2; color: #1976d2; }
.modal-close {
  font-size: 20px;
  color: #999;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.modal-close:hover { color: #333; }
.modal-search { padding: 10px 16px; }
.modal-search .search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.modal-search .search-input:focus { border-color: #007aff; }
.modal-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 12px;
}
.modal-group { margin-bottom: 4px; }
.modal-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.modal-group-count {
  font-size: 10px;
  color: #fff;
  background: #ccc;
  border-radius: 8px;
  padding: 0 6px;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
}
.modal-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  text-align: left;
  transition: background 0.12s;
}
.modal-item:hover:not(.disabled) { background: #f0f7ff; }
.modal-item.active { background: #e3f2fd; }
.modal-item.disabled { opacity: 0.45; cursor: default; }
.modal-item-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: #f0f0f0;
  overflow: hidden;
}
.modal-item-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.modal-item-avatar-letter { font-size: 13px; font-weight: 600; color: #666; }
.modal-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.modal-item-name { font-size: 13px; font-weight: 500; color: #333; }
.modal-item-desc { font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.modal-item-badge {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 8px;
  flex-shrink: 0;
}
.modal-item-badge.main { background: #e3f2fd; color: #1976d2; }
.modal-item-badge.sub { background: #f5f5f5; color: #999; }
.modal-item-badge.multi-group { background: #fff3e0; color: #e65100; }
.modal-empty { padding: 32px; text-align: center; font-size: 13px; color: #999; }
</style>
