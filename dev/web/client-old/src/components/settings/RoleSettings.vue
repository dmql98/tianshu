<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharactersStore } from '@/stores/characters'
import { fetchSkills } from '@/api/skills'
import { fetchTools } from '@/api/tools'
import type { CharacterConfig, Character, ToolBinding } from '@/api/characters'
import type { ToolMeta } from '@/api/tools'
import ToolBindingEditor from '@/components/settings/ToolBindingEditor.vue'

const { t } = useI18n()
const store = useCharactersStore()

const searchQuery = ref('')
const selectedId = ref<string | null>(null)
const showForm = ref(false)
const groupView = ref(false)
const activeTab = ref<'basic' | 'memory' | 'tools' | 'skills' | 'knowledge'>('basic')

const editingSection = ref<'soul' | 'user' | 'memory' | null>(null)
const editContent = ref('')
const isNew = ref(false)

const allSkills = ref<{ name: string; description: string }[]>([])
const allTools = ref<ToolMeta[]>([])
const newGroupName = ref('')
const showNewGroupInput = ref(false)

const form = ref<CharacterConfig>({
  name: '',
  description: '',
  avatar: '',
  color: '#6366f1',
  soul: '',
  userProfile: '',
  memory: { enabled: false, selfEvolution: false, charLimit: 2200 },
  memoryContent: '',
  tools: [],
  maxSteps: 10,
  role: 'both',
  groups: [],
  default_strategy: 'Ask',
  skills: [],
  enabled: true,
})

const displayGroups = computed(() => {
  const g = new Set<string>()
  for (const c of store.characters) {
    if (c.groups) c.groups.forEach((gr: string) => g.add(gr))
  }
  if (form.value.groups) form.value.groups.forEach(gr => g.add(gr))
  return [...g].sort()
})

const filteredCharacters = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return store.characters.filter(c =>
    !q || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q)
  )
})

const groupedCharacters = computed(() => {
  const groups = new Map<string, typeof store.characters>()
  const uncategorized: typeof store.characters = []
  for (const c of filteredCharacters.value) {
    if (!c.groups || c.groups.length === 0) { uncategorized.push(c); continue }
    for (const grp of c.groups) {
      if (!groups.has(grp)) groups.set(grp, [])
      groups.get(grp)!.push(c)
    }
  }
  const result: { name: string; characters: typeof store.characters }[] = []
  for (const [name, chars] of groups) {
    result.push({ name, characters: chars })
  }
  result.sort((a, b) => a.name.localeCompare(b.name))
  if (uncategorized.length > 0) result.push({ name: 'Uncategorized', characters: uncategorized })
  return result
})

function getFormValue(key: 'soul' | 'user' | 'memory'): string {
  if (key === 'soul') return form.value.soul || ''
  if (key === 'user') return form.value.userProfile || ''
  return form.value.memoryContent || ''
}

function toggleGroup(grp: string) {
  const g = form.value.groups || []
  const idx = g.indexOf(grp)
  if (idx >= 0) g.splice(idx, 1)
  else g.push(grp)
}

function addNewGroup() {
  const name = newGroupName.value.trim()
  if (name && !(form.value.groups || []).includes(name)) {
    const g = form.value.groups || []
    g.push(name)
  }
  newGroupName.value = ''
  showNewGroupInput.value = false
}

function toggleSkill(name: string) {
  const s = form.value.skills || []
  const idx = s.indexOf(name)
  if (idx >= 0) s.splice(idx, 1)
  else s.push(name)
}

function select(id: string) {
  selectedId.value = id
  isNew.value = false
  showForm.value = true
  activeTab.value = 'basic'
  const c = store.characters.find(x => x.id === id)
  if (c) {
    form.value = {
      name: c.name,
      description: c.description || '',
      avatar: c.avatar || '',
      color: c.color || '#6366f1',
      soul: c.soul || '',
      userProfile: c.userProfile || '',
      memory: c.memory ? { ...c.memory, charLimit: c.memory.charLimit ?? 2200, selfEvolution: c.memory.selfEvolution ?? false } : { enabled: false, selfEvolution: false, charLimit: 2200 },
      memoryContent: c.memoryContent || '',
      tools: c.tools ? c.tools.map(t => typeof t === 'string' ? { name: t } : { ...t }).filter(t => typeof t.name === 'string') as ToolBinding[] : [],
      maxSteps: c.maxSteps ?? 10,
      role: c.role || 'both',
      groups: c.groups ? [...c.groups] : [],
      default_strategy: c.default_strategy || 'Ask',
      skills: c.skills ? [...c.skills] : [],
      enabled: c.enabled ?? true,
      customPrompt: c.customPrompt || '',
    }
  }
}

function startCreate() {
  selectedId.value = null
  isNew.value = true
  showForm.value = true
  activeTab.value = 'basic'
  form.value = {
    name: '',
    description: '',
    avatar: '',
    color: '#6366f1',
    soul: '',
    userProfile: '',
    memory: { enabled: false, selfEvolution: false, charLimit: 2200 },
    memoryContent: '',
    tools: [],
    maxSteps: 10,
    role: 'both',
    groups: [],
    default_strategy: 'Ask',
    skills: [],
    enabled: true,
    customPrompt: '',
  }
}

onMounted(async () => {
  try {
    const [skillsRes, toolsRes] = await Promise.all([fetchSkills(), fetchTools()])
    allSkills.value = skillsRes.skills.map(s => ({ name: s.name, description: s.description }))
    allTools.value = toolsRes.tools
  } catch { /* skills or tools unavailable */ }
})

async function handleDelete(id: string) {
  await store.remove(id)
  if (selectedId.value === id) {
    selectedId.value = null
    showForm.value = false
  }
}

function handleCancel() {
  showForm.value = false
  selectedId.value = null
  isNew.value = false
}

async function handleSave() {
  if (!form.value.name.trim()) return
  if (isNew.value) {
    const created = await store.create(form.value)
    selectedId.value = created.id
    isNew.value = false
  } else if (selectedId.value) {
    await store.update(selectedId.value, form.value)
  }
  showForm.value = false
}

function handleAvatarUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => { form.value.avatar = e.target?.result as string }
  reader.readAsDataURL(file)
  input.value = ''
}

function removeAvatar() { form.value.avatar = '' }

function startEdit(section: 'soul' | 'user' | 'memory') {
  editingSection.value = section
  if (section === 'soul') editContent.value = form.value.soul || ''
  else if (section === 'user') editContent.value = form.value.userProfile || ''
  else editContent.value = form.value.memoryContent || ''
}

function cancelEdit() { editingSection.value = null; editContent.value = '' }

function saveEdit() {
  if (!editingSection.value) return
  if (editingSection.value === 'soul') form.value.soul = editContent.value
  else if (editingSection.value === 'user') form.value.userProfile = editContent.value
  else form.value.memoryContent = editContent.value
  editingSection.value = null
  editContent.value = ''
}



</script>

<template>
  <div class="role-settings">
    <div class="role-layout">
      <!-- Left: Character List -->
      <aside class="role-list-panel">
        <div class="role-list-header">
          <span class="role-list-title">{{ t('role.characterList') }}</span>
          <span class="role-count">{{ store.characters.length }}</span>
          <button class="group-toggle" :class="{ active: groupView }" @click="groupView = !groupView" :title="groupView ? 'Flat view' : 'Group view'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </button>
        </div>
        <div class="role-search">
          <input v-model="searchQuery" class="search-input" :placeholder="t('role.searchPlaceholder')" />
        </div>
        <div class="role-items">
          <template v-if="groupView">
            <div v-for="grp in groupedCharacters" :key="grp.name" class="role-group-section">
              <div class="role-group-header">{{ grp.name }} <span class="role-group-count">{{ grp.characters.length }}</span></div>
              <button
                v-for="c in grp.characters"
                :key="c.id"
                :class="['role-item', { active: selectedId === c.id }]"
                @click="select(c.id)"
              >
                <span class="role-avatar" :style="{ borderColor: c.color || '#999' }">
                  <img v-if="c.avatar" :src="c.avatar" class="role-avatar-img" />
                  <span v-else class="role-avatar-letter">{{ c.name.charAt(0).toUpperCase() }}</span>
                </span>
                <span class="role-info">
                  <span class="role-name">{{ c.name }}</span>
                  <span class="role-desc">{{ c.description || '' }}</span>
                </span>
                <span v-if="c.builtIn" class="role-badge">{{ t('role.builtIn') }}</span>
                <span v-else class="role-actions">
                  <span class="role-action-btn edit-btn" @click.stop="select(c.id)" :title="t('common.edit')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </span>
                  <span class="role-action-btn delete-btn" @click.stop="handleDelete(c.id)" :title="t('common.delete')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </span>
                </span>
              </button>
            </div>
            <div v-if="groupedCharacters.length === 0" class="role-empty">
              {{ t('role.noCharacters') }}
            </div>
          </template>
          <template v-else>
            <button
              v-for="c in filteredCharacters"
              :key="c.id"
              :class="['role-item', { active: selectedId === c.id }]"
              @click="select(c.id)"
            >
              <span class="role-avatar" :style="{ borderColor: c.color || '#999' }">
                <img v-if="c.avatar" :src="c.avatar" class="role-avatar-img" />
                <span v-else class="role-avatar-letter">{{ c.name.charAt(0).toUpperCase() }}</span>
              </span>
              <span class="role-info">
                <span class="role-name">{{ c.name }}</span>
                <span class="role-desc">{{ c.description || '' }}</span>
              </span>
              <span v-if="c.builtIn" class="role-badge">{{ t('role.builtIn') }}</span>
              <span v-else class="role-actions">
                <span class="role-action-btn edit-btn" @click.stop="select(c.id)" :title="t('common.edit')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </span>
                <span class="role-action-btn delete-btn" @click.stop="handleDelete(c.id)" :title="t('common.delete')">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </span>
              </span>
            </button>
            <div v-if="filteredCharacters.length === 0" class="role-empty">
              {{ t('role.noCharacters') }}
            </div>
          </template>
        </div>
        <div class="role-list-footer">
          <button class="create-btn" @click="startCreate">+ {{ t('role.create') }}</button>
        </div>
      </aside>

      <!-- Right: Character Form -->
      <div class="role-detail-panel">
        <div v-if="!showForm" class="role-detail-empty">
          <p>{{ t('role.noSelection') }}</p>
        </div>
        <div v-else class="character-form">
          <!-- Sub Tabs -->
          <div class="sub-tabs">
            <button
              v-for="tab in (isNew ? ['basic'] : ['basic', 'memory', 'tools', 'skills', 'knowledge', 'prompt'])"
              :key="tab"
              :class="['sub-tab', { active: activeTab === tab }]"
              @click="activeTab = tab as any"
            >{{ t(`role.tab.${tab}`) }}</button>
          </div>

          <!-- Basic Tab -->
          <div v-if="activeTab === 'basic'" class="tab-content">
            <div class="form-top">
              <div class="form-left">
                <div class="avatar-preview" :style="{ borderColor: form.color || '#6366f1' }">
                  <img v-if="form.avatar" :src="form.avatar" class="avatar-img" />
                  <span v-else class="avatar-placeholder">{{ form.name?.charAt(0) || '?' }}</span>
                </div>
                <input type="color" v-model="form.color" class="color-picker" />
                <div class="avatar-actions">
                  <label class="avatar-upload-btn">
                    <input type="file" accept="image/*" hidden @change="handleAvatarUpload" />
                    {{ t('role.uploadAvatar') }}
                  </label>
                  <button v-if="form.avatar" class="avatar-remove-btn" @click="removeAvatar">
                    {{ t('role.removeAvatar') }}
                  </button>
                </div>
              </div>
              <div class="form-right">
                <div class="field">
                  <label class="field-label">{{ t('role.name') }}</label>
                  <input v-model="form.name" class="field-input" :placeholder="t('role.namePlaceholder')" />
                </div>
                <div class="field">
                  <label class="field-label">{{ t('role.description') }}</label>
                  <textarea v-model="form.description" class="field-textarea" :rows="2" :placeholder="t('role.descPlaceholder')"></textarea>
                </div>
                <label class="toggle-row">
                  <span class="toggle-label">{{ t('role.enabled') }}</span>
                  <input type="checkbox" v-model="form.enabled" class="toggle-input" />
                  <span class="toggle-switch"></span>
                </label>
                <label class="toggle-row">
                  <span class="toggle-label">{{ t('role.selfEvolution') }}</span>
                  <input type="checkbox" v-model="form.memory!.selfEvolution!" class="toggle-input" />
                  <span class="toggle-switch"></span>
                </label>
                <div class="field">
                  <label class="field-label">Role</label>
                  <select v-model="form.role" class="field-input">
                    <option value="main">Main</option>
                    <option value="sub">Sub</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">Default Strategy</label>
                  <select v-model="form.default_strategy" class="field-input">
                    <option value="Plan">Plan</option>
                    <option value="Ask">Ask</option>
                    <option value="Bypass">Bypass</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field-label">最大运行轮数</label>
                  <div class="field-slider-group">
                    <input :value="form.maxSteps" @input="form.maxSteps = Number(($event.target as HTMLInputElement).value)" type="range" min="1" max="999" class="field-slider" />
                    <input :value="form.maxSteps" @input="form.maxSteps = Number(($event.target as HTMLInputElement).value)" type="number" min="1" max="999" class="field-number" />
                  </div>
                </div>
                <div class="field">
                  <label class="field-label">Groups</label>
                  <div class="group-chips">
                    <span v-for="grp in displayGroups" :key="grp" :class="['group-chip', { active: form.groups?.includes(grp) }]" @click="toggleGroup(grp)">{{ grp }}</span>
                    <span v-if="showNewGroupInput" class="group-input-wrap">
                      <input v-model="newGroupName" class="group-input" placeholder="New group" @keyup.enter="addNewGroup" @blur="addNewGroup" />
                    </span>
                    <span v-else class="group-add-btn" @click="showNewGroupInput = true">+</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Soul -->
            <div class="memory-section" style="margin-top: 16px;">
              <div class="section-header">
                <div class="section-title-row">
                  <span class="section-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    </svg>
                  </span>
                  <span class="section-title">{{ t('role.soul') }}</span>
                </div>
                <div class="section-header-right">
                  <button v-if="editingSection !== 'soul'" class="section-edit-btn" @click="startEdit('soul')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {{ t('common.edit') }}
                  </button>
                </div>
              </div>
              <div v-if="editingSection !== 'soul'" class="section-body">
                <p v-if="!getFormValue('soul')" class="empty-text">{{ t('role.soulPlaceholder') }}</p>
                <div v-else class="content-text">{{ getFormValue('soul') }}</div>
              </div>
              <div v-else class="section-edit">
                <textarea v-model="editContent" class="edit-textarea" :placeholder="t('role.soulPlaceholder')" spellcheck="false" />
                <div class="edit-actions">
                  <button class="btn btn-sm" @click="cancelEdit">{{ t('common.cancel') }}</button>
                  <button class="btn btn-sm btn-primary" @click="saveEdit">{{ t('common.save') }}</button>
                </div>
              </div>
            </div>

            <!-- User Profile -->
            <div class="memory-section" style="margin-top: 12px;">
              <div class="section-header">
                <div class="section-title-row">
                  <span class="section-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    </svg>
                  </span>
                  <span class="section-title">{{ t('role.userProfile') }}</span>
                </div>
                <div class="section-header-right">
                  <button v-if="editingSection !== 'user'" class="section-edit-btn" @click="startEdit('user')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    {{ t('common.edit') }}
                  </button>
                </div>
              </div>
              <div v-if="editingSection !== 'user'" class="section-body">
                <p v-if="!getFormValue('user')" class="empty-text">{{ t('role.userProfilePlaceholder') }}</p>
                <div v-else class="content-text">{{ getFormValue('user') }}</div>
              </div>
              <div v-else class="section-edit">
                <textarea v-model="editContent" class="edit-textarea" :placeholder="t('role.userProfilePlaceholder')" spellcheck="false" />
                <div class="edit-actions">
                  <button class="btn btn-sm" @click="cancelEdit">{{ t('common.cancel') }}</button>
                  <button class="btn btn-sm btn-primary" @click="saveEdit">{{ t('common.save') }}</button>
                </div>
              </div>
            </div>

          </div>

          <!-- Tools Tab -->
          <div v-if="activeTab === 'tools'" class="tab-content">
            <ToolBindingEditor v-model="form.tools" :allTools="allTools" />
          </div>

          <!-- Memory Tab -->
          <div v-if="activeTab === 'memory'" class="tab-content">
            <div class="memory-section">
              <div class="section-header">
                <div class="section-title-row">
                  <span class="section-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    </svg>
                  </span>
                  <span class="section-title">{{ t('role.memory') }}</span>
                </div>
                <div class="section-header-right">
                  <label class="toggle-sm">
                    <input type="checkbox" v-model="form.memory!.enabled" class="toggle-input" />
                    <span class="toggle-switch"></span>
                  </label>
                </div>
              </div>
              <div v-if="!form.memory?.enabled" class="section-body">
                <p class="empty-text">{{ t('role.memoryDisabledHint') }}</p>
              </div>
              <div v-else class="section-body">
                <label class="toggle-row">
                  <span class="toggle-label">{{ t('role.selfEvolution') }}</span>
                  <input type="checkbox" v-model="form.memory!.selfEvolution!" class="toggle-input" />
                  <span class="toggle-switch"></span>
                </label>
                <div class="field" style="margin-top: 12px;">
                  <label class="field-label">{{ t('role.charLimit') }}</label>
                  <input type="number" v-model.number="form.memory!.charLimit!" class="field-input" min="100" max="10000" />
                </div>
                <div class="memory-section" style="margin-top: 16px;">
                  <div class="section-header">
                    <div class="section-title-row">
                      <span class="section-title">{{ t('role.memoryContent') }}</span>
                    </div>
                    <div class="section-header-right">
                      <button v-if="editingSection !== 'memory'" class="section-edit-btn" @click="startEdit('memory')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        {{ t('common.edit') }}
                      </button>
                    </div>
                  </div>
                  <div v-if="editingSection !== 'memory'" class="section-body">
                    <p v-if="!getFormValue('memory')" class="empty-text">{{ t('role.memoryPlaceholder') }}</p>
                    <div v-else class="content-text">{{ getFormValue('memory') }}</div>
                  </div>
                  <div v-else class="section-edit">
                    <textarea v-model="editContent" class="edit-textarea" :placeholder="t('role.memoryPlaceholder')" spellcheck="false" />
                    <div class="edit-actions">
                      <button class="btn btn-sm" @click="cancelEdit">{{ t('common.cancel') }}</button>
                      <button class="btn btn-sm btn-primary" @click="saveEdit">{{ t('common.save') }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Skills Tab -->
          <div v-if="activeTab === 'skills'" class="tab-content">
            <div class="skills-section">
              <p class="section-subtitle">Available Skills</p>
              <div v-if="allSkills.length === 0" class="placeholder-tab">
                <p>No skills available. Create skills in the Skills settings tab.</p>
              </div>
              <div v-else class="skills-grid">
                <label v-for="sk in allSkills" :key="sk.name" :class="['skill-check', { active: form.skills?.includes(sk.name) }]">
                  <input type="checkbox" :checked="form.skills?.includes(sk.name)" @change="toggleSkill(sk.name)" />
                  <span class="skill-name">{{ sk.name }}</span>
                  <span class="skill-desc">{{ sk.description }}</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Knowledge Tab -->
          <div v-if="activeTab === 'knowledge'" class="tab-content">
            <div class="placeholder-tab">
              <p>{{ t('role.knowledgePlaceholder') }}</p>
            </div>
          </div>

          <!-- Prompt Tab -->
          <div v-if="activeTab === 'prompt'" class="tab-content">
            <div class="section-header" style="margin-bottom: 12px;">
              <div class="section-title-row">
                <span class="section-title">自定义提示词</span>
              </div>
              <div class="section-header-right">
                <label class="toggle-sm" style="font-size: 12px; gap: 6px;">
                  <input type="checkbox" class="toggle-input" :checked="!!form.customPrompt" @change="form.customPrompt = form.customPrompt ? '' : (form.customPrompt || '# 自定义提示词\n\n## System Prompt\n\n{{GUIDANCE}}')" />
                  <span class="toggle-switch"></span>
                  使用自定义提示词
                </label>
              </div>
            </div>
            <p style="font-size: 12px; color: #888; margin: -8px 0 12px;">
              未开启时使用默认提示词模板（<code>data/prompts/default.md</code>）。
              开启后使用下方内容，<code>{{GUIDANCE}}</code> 会被自动替换为工具使用指引。
            </p>
            <textarea v-if="form.customPrompt" v-model="form.customPrompt" class="prompt-editor" placeholder="输入自定义提示词..." />
            <div v-else class="placeholder-tab">
              <p>使用默认提示词</p>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="form-actions">
            <button class="btn" @click="handleCancel">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" @click="handleSave">{{ t('common.save') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.role-settings {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.role-layout {
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
}

/* ── Left: Character List ── */
.role-list-panel {
  width: 280px;
  min-width: 280px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.role-list-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 14px;
  border-bottom: 1px solid #e0e0e0;
  background: #fff;
}

.role-list-title { font-size: 14px; font-weight: 600; color: #333; flex: 1; }

.group-toggle {
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
  flex-shrink: 0;
}
.group-toggle:hover { border-color: #1976d2; color: #1976d2; }
.group-toggle.active { background: #e3f2fd; border-color: #1976d2; color: #1976d2; }

.role-group-section { border-bottom: 1px solid #f0f0f0; }
.role-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: #f8f8f8;
  position: sticky;
  top: 0;
  z-index: 1;
}
.role-group-count {
  font-size: 10px;
  color: #fff;
  background: #bbb;
  border-radius: 8px;
  padding: 0 6px;
  min-width: 16px;
  text-align: center;
  line-height: 16px;
}

.role-count {
  font-size: 11px;
  color: #fff;
  background: #1976d2;
  border-radius: 10px;
  padding: 1px 7px;
  min-width: 20px;
  text-align: center;
}

.role-search {
  padding: 8px 10px;
  border-bottom: 1px solid #e0e0e0;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  background: #fff;
}

.search-input:focus { border-color: #1976d2; }

.role-items {
  flex: 1;
  overflow-y: auto;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  text-align: left;
  border-bottom: 1px solid #f0f0f0;
}

.role-item:last-child { border-bottom: none; }
.role-item:hover { background: #f0f7ff; }
.role-item.active { background: #e3f2fd; }

.role-avatar {
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

.role-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.role-avatar-letter { font-size: 13px; font-weight: 600; color: #666; }

.role-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.role-name { font-size: 13px; font-weight: 500; color: #333; }
.role-desc { font-size: 11px; color: #999; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.role-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #e3f2fd;
  color: #1976d2;
  flex-shrink: 0;
}

.role-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.role-item:hover .role-actions { opacity: 1; }

.role-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  color: #888;
}

.role-action-btn:hover { background: rgba(0,0,0,0.06); }
.edit-btn:hover { color: #1976d2; }
.delete-btn:hover { color: #d32f2f; }

.role-empty {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: #999;
}

.role-list-footer {
  padding: 8px 10px;
  border-top: 1px solid #e0e0e0;
}

.create-btn {
  width: 100%;
  padding: 7px;
  border: 1px dashed #bbb;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #555;
}

.create-btn:hover {
  background: #e3f2fd;
  border-color: #1976d2;
  color: #1976d2;
}

/* ── Right: Detail Panel ── */
.role-detail-panel {
  flex: 1;
  min-width: 0;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fff;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.role-detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}

/* ── Character Form ── */
.character-form {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Sub Tabs */
.sub-tabs {
  display: flex;
  border-bottom: 1px solid #e0e0e0;
  padding: 0 16px;
  background: #fafafa;
  flex-shrink: 0;
}

.sub-tab {
  padding: 10px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #888;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
}

.sub-tab:hover { color: #333; }
.sub-tab.active {
  color: #1976d2;
  font-weight: 500;
  border-bottom-color: #1976d2;
}

.tab-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

/* ── Basic Tab ── */
.form-top {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

.form-left {
  width: 100px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.avatar-preview {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: 3px solid;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.avatar-img { width: 100%; height: 100%; object-fit: cover; }
.avatar-placeholder { font-size: 28px; font-weight: 600; color: #bbb; }

.color-picker {
  width: 100%;
  height: 28px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 1px;
  cursor: pointer;
  background: none;
}

.avatar-actions { display: flex; flex-direction: column; gap: 4px; align-items: center; font-size: 12px; }
.avatar-upload-btn { color: #1976d2; cursor: pointer; text-decoration: underline; }
.avatar-remove-btn { background: none; border: none; color: #d32f2f; cursor: pointer; text-decoration: underline; font-size: 12px; padding: 0; }

.form-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.3px; }

.field-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  background: #fff;
}
.field-input:focus { border-color: #1976d2; }
.field-slider-group { display: flex; align-items: center; gap: 8px; }
.field-slider { flex: 1; max-width: 180px; }
.field-number { width: 70px; padding: 4px 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: center; }
.field-number:focus { border-color: #1976d2; outline: none; }

.field-textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
  background: #fff;
}
.field-textarea:focus { border-color: #1976d2; }

/* Toggle */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.toggle-label { font-size: 13px; color: #333; }

.toggle-input { display: none; }

.toggle-switch {
  position: relative;
  width: 36px;
  height: 20px;
  background: #ccc;
  border-radius: 10px;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-input:checked + .toggle-switch { background: #1976d2; }
.toggle-input:checked + .toggle-switch::after { transform: translateX(16px); }

.toggle-sm { cursor: pointer; display: inline-flex; align-items: center; }
.toggle-sm .toggle-switch {
  width: 28px;
  height: 16px;
}
.toggle-sm .toggle-switch::after {
  width: 12px;
  height: 12px;
}
.toggle-sm .toggle-input:checked + .toggle-switch::after { transform: translateX(12px); }

.form-divider {
  height: 1px;
  background: #e0e0e0;
  margin: 16px 0;
}

/* Permissions */
.section-subtitle { font-size: 14px; font-weight: 600; color: #333; margin: 0 0 12px; }

.perm-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.perm-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.perm-key {
  width: 80px;
  font-size: 13px;
  font-weight: 500;
  color: #555;
}

.perm-radio-group {
  display: flex;
  gap: 4px;
}

.perm-radio {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  background: #fff;
}

.perm-radio.active {
  border-color: #1976d2;
  color: #1976d2;
  background: #e3f2fd;
}

.perm-radio input { display: none; }

.perm-desc {
  font-size: 11px;
  color: #aaa;
  margin-left: 8px;
  font-family: 'SF Mono', 'Consolas', monospace;
}

/* ── Tools Tab ── */
.tools-section {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
}
.tools-grid {
  padding: 8px 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.tool-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.tool-toggle-row:hover { background: #f5f5f5; }
.tool-name {
  font-size: 13px;
  font-family: 'SF Mono', 'Consolas', monospace;
  color: #555;
}
.tools-hint {
  padding: 6px 12px 8px;
  font-size: 11px;
  color: #aaa;
  margin: 0;
}

/* ── Memory Tab ── */
.memory-section {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 12px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-icon { color: #888; display: flex; }
.section-title { font-size: 13px; font-weight: 600; color: #333; }

.section-header-right { display: flex; align-items: center; gap: 6px; }

.section-edit-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #666;
}

.section-edit-btn:hover { border-color: #1976d2; color: #1976d2; }

.section-body {
  padding: 12px;
  min-height: 32px;
}

.content-text {
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-text {
  color: #bbb;
  font-style: italic;
  font-size: 13px;
  margin: 0;
}

.section-edit {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
}

.edit-textarea {
  width: 100%;
  height: 180px;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  color: #333;
  font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}

.edit-textarea:focus { border-color: #1976d2; }

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

/* ── Group Chips ── */
.group-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.group-chip {
  display: inline-flex;
  padding: 2px 10px;
  border: 1px solid #ddd;
  border-radius: 12px;
  font-size: 12px;
  color: #666;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.group-chip:hover { border-color: #1976d2; color: #1976d2; }
.group-chip.active { background: #e3f2fd; border-color: #1976d2; color: #1976d2; }
.group-input-wrap { display: inline-flex; }
.group-input {
  width: 80px;
  padding: 2px 6px;
  font-size: 12px;
  border: 1px solid #1976d2;
  border-radius: 4px;
  outline: none;
}
.group-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px dashed #bbb;
  border-radius: 50%;
  font-size: 14px;
  color: #999;
  cursor: pointer;
}
.group-add-btn:hover { border-color: #1976d2; color: #1976d2; }

/* ── Skills Grid ── */
.skills-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.skill-check {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.skill-check:hover { border-color: #1976d2; background: #f8fbff; }
.skill-check.active { border-color: #1976d2; background: #e3f2fd; }
.skill-check input { display: none; }
.skill-name { font-size: 13px; font-weight: 600; color: #333; min-width: 80px; }
.skill-desc { font-size: 12px; color: #888; }

/* ── Placeholder tabs ── */
.placeholder-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #bbb;
  font-size: 13px;
}

/* ── Buttons ── */
.btn {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  transition: all 0.15s;
}

.btn:hover { background: #f5f5f5; }
.btn-primary { background: #1976d2; color: #fff; border-color: #1976d2; }
.btn-primary:hover { background: #1565c0; }
.btn-sm { padding: 5px 12px; font-size: 12px; }

.form-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid #e0e0e0;
  flex-shrink: 0;
  background: #fafafa;
}
.prompt-editor {
  width: 100%;
  min-height: 300px;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}
.prompt-editor:focus { border-color: #1976d2; outline: none; }
</style>
