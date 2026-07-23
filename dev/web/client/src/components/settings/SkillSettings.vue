<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchSkills, fetchSkillDetail, fetchSkillFile, type SkillMeta, type SkillDetail, type SkillFile, type FileContent } from '@/api/skills'

const { t } = useI18n()

type SourceFilter = 'builtin' | 'hub' | 'local' | 'external' | 'modified'

const allSkills = ref<SkillMeta[]>([])
const allTags = ref<string[]>([])
const selectedTags = ref<Set<string>>(new Set())
const tagQuery = ref('')
const showTagDropdown = ref(false)
const sourceFilter = ref<SourceFilter | null>(null)
const searchQuery = ref('')
const showSidebar = ref(true)
const selectedSkill = ref<SkillDetail | null>(null)
const loading = ref(true)
const viewingFile = ref<FileContent | null>(null)
const fileLoading = ref(false)

const sourceDotColors: Record<string, string> = {
  builtin: '#888',
  hub: '#4a90d9',
  local: '#66bb6a',
  external: '#f59e0b',
}

const legendItems = [
  { key: 'builtin' as SourceFilter, label: t('skillSetting.source.builtin') },
  { key: 'hub' as SourceFilter, label: t('skillSetting.source.hub') },
  { key: 'local' as SourceFilter, label: t('skillSetting.source.local') },
  { key: 'external' as SourceFilter, label: t('skillSetting.source.external') },
  { key: 'modified' as SourceFilter, label: t('skillSetting.modified') },
]

const filteredSkills = computed(() => {
  let list = allSkills.value
  if (selectedTags.value.size > 0) {
    list = list.filter(s => s.tags.some(t => selectedTags.value.has(t)))
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  }
  return list
})

const categories = computed(() => {
  const map = new Map<string, SkillMeta[]>()
  for (const s of filteredSkills.value) {
    const cat = s.category || 'other'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(s)
  }
  return [...map.entries()].map(([name, skills]) => ({ name, skills }))
})

const collapsedCategories = ref<Set<string>>(new Set())

function toggleFilter(filter: SourceFilter) {
  sourceFilter.value = sourceFilter.value === filter ? null : filter
}

const filteredTagOptions = computed(() =>
  allTags.value.filter(t => !selectedTags.value.has(t) && t.includes(tagQuery.value))
)

function addTag(tag: string) {
  selectedTags.value = new Set([...selectedTags.value, tag])
  tagQuery.value = ''
  showTagDropdown.value = false
  collapsedCategories.value = new Set()
}

function removeTag(tag: string) {
  const next = new Set(selectedTags.value)
  next.delete(tag)
  selectedTags.value = next
}

function onTagInput() {
  showTagDropdown.value = true
}

function hideTagDropdown() {
  setTimeout(() => { showTagDropdown.value = false }, 150)
}

function onTagDropdownClick(tag: string) {
  addTag(tag)
}

function toggleCategory(name: string) {
  const next = new Set(collapsedCategories.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  collapsedCategories.value = next
}

async function selectSkill(s: SkillMeta) {
  viewingFile.value = null
  selectedSkill.value = null
  try {
    selectedSkill.value = await fetchSkillDetail(s.category, s.name)
  } catch (err: any) {
    console.error('Failed to load skill:', err)
  }
}

async function viewFile(file: SkillFile) {
  if (!selectedSkill.value) return
  fileLoading.value = true
  try {
    viewingFile.value = await fetchSkillFile(selectedSkill.value.category, selectedSkill.value.name, file.path)
  } catch (err: any) {
    console.error('Failed to load file:', err)
  } finally {
    fileLoading.value = false
  }
}

function backToSkill() {
  viewingFile.value = null
}

onMounted(async () => {
  try {
    const data = await fetchSkills()
    allSkills.value = data.skills
    allTags.value = data.tags
  } catch (err: any) {
    console.error('Failed to load skills:', err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="skill-settings">
    <header class="ss-header">
      <div class="ss-header-row">
        <div class="ss-header-left">
          <h3 class="ss-title">{{ t('skillSetting.title') }}</h3>
          <button v-if="!showSidebar" class="ss-sidebar-toggle" @click="showSidebar = true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="ss-legend">
          <button
            v-for="item in legendItems"
            :key="item.key"
            class="ss-legend-item"
            :class="{ active: sourceFilter === item.key }"
            @click="toggleFilter(item.key)"
          >
            <span v-if="item.key !== 'modified'" class="ss-legend-dot" :style="{ background: sourceDotColors[item.key] }" />
            <span v-else class="ss-modified-icon">&#9998;</span>
            {{ item.label }}
          </button>
        </div>
        <div class="ss-header-actions">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('skillSetting.searchPlaceholder')"
            class="ss-search-input"
          />
          <div class="ss-tag-select">
            <div class="ss-tag-chips">
              <span v-for="tag in selectedTags" :key="tag" class="ss-tag-chip">
                {{ tag }}
                <button class="ss-tag-chip-remove" @click="removeTag(tag)">&times;</button>
              </span>
              <input
                v-model="tagQuery"
                type="text"
                :placeholder="selectedTags.size > 0 ? '' : t('skillSetting.tagPlaceholder')"
                class="ss-tag-input"
                @focus="showTagDropdown = true"
                @input="onTagInput"
                @blur="hideTagDropdown"
              />
            </div>
            <div v-if="showTagDropdown && filteredTagOptions.length > 0" class="ss-tag-dropdown">
              <button
                v-for="tag in filteredTagOptions"
                :key="tag"
                class="ss-tag-dropdown-item"
                @mousedown.prevent="onTagDropdownClick(tag)"
              >{{ tag }}</button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="ss-body">
      <div class="ss-mobile-backdrop" :class="{ active: showSidebar }" @click="showSidebar = false" />

      <aside v-if="showSidebar" class="ss-sidebar">
        <div v-if="loading" class="ss-loading">{{ t('common.loading') }}</div>
        <div v-else-if="categories.length === 0" class="ss-empty-list">{{ t('skillSetting.noSkills') }}</div>
        <div v-else class="ss-category-list">
          <div v-for="cat in categories" :key="cat.name" class="ss-category">
            <button class="ss-category-header" @click="toggleCategory(cat.name)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                class="ss-cat-arrow" :class="{ collapsed: collapsedCategories.has(cat.name) }">
                <polyline points="6 9 12 15 18 9" />
              </svg>
              <span class="ss-cat-name">{{ cat.name }}</span>
              <span class="ss-cat-count">{{ cat.skills.length }}</span>
            </button>
            <div v-if="!collapsedCategories.has(cat.name)" class="ss-category-skills">
              <button
                v-for="s in cat.skills"
                :key="`${s.category}/${s.name}`"
                :class="['ss-skill-item', { active: selectedSkill?.name === s.name && selectedSkill?.category === s.category }]"
                @click="selectSkill(s)"
              >
                <div class="ss-skill-info">
                  <span class="ss-skill-name">{{ s.name }}</span>
                  <span class="ss-skill-tags-row">
                    <span v-for="tag in s.tags" :key="tag" class="ss-skill-tag">{{ tag }}</span>
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div class="ss-sidebar-footer">
          <button class="ss-import-btn">{{ t('skillSetting.import') }}</button>
        </div>
      </aside>

      <main class="ss-main">
        <div v-if="viewingFile" class="ss-file-view">
          <div class="ss-file-header">
            <button class="ss-back-btn" @click="backToSkill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              {{ t('skillSetting.back') }}
            </button>
            <span class="ss-file-name">{{ viewingFile.name }}</span>
          </div>
          <div class="ss-file-content">
            <div v-if="fileLoading" class="ss-loading">{{ t('common.loading') }}</div>
            <pre v-else class="ss-file-body"><code>{{ viewingFile.content }}</code></pre>
          </div>
        </div>

        <div v-else-if="!selectedSkill" class="ss-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.15">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <span>{{ t('skillSetting.selectHint') }}</span>
        </div>

        <div v-else class="ss-detail">
          <div class="ss-detail-header">
            <span class="ss-detail-category">{{ selectedSkill.category }}</span>
            <span class="ss-detail-sep">/</span>
            <span class="ss-detail-name">{{ selectedSkill.name }}</span>
            <div class="ss-detail-tags">
              <span v-for="tag in selectedSkill.tags" :key="tag" class="ss-detail-tag-chip">{{ tag }}</span>
            </div>
          </div>
          <div class="ss-detail-body">
            <div class="ss-detail-md">
              <pre>{{ selectedSkill.body }}</pre>
            </div>
          </div>
          <div v-if="selectedSkill.files.length > 0" class="ss-detail-files">
            <div v-for="type in ['reference', 'script', 'template', 'test', 'asset', 'other']" :key="type">
              <div v-if="selectedSkill.files.filter(f => f.type === type).length > 0" class="ss-file-group">
                <span class="ss-file-group-label">{{ type }}</span>
                <div class="ss-file-chips">
                  <button
                    v-for="f in selectedSkill.files.filter(ff => ff.type === type)"
                    :key="f.path"
                    class="ss-file-chip"
                    @click="viewFile(f)"
                  >{{ f.name }}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.skill-settings {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ss-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid #e0e0e0;
  flex-shrink: 0;
}

.ss-header-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ss-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ss-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin: 0;
  white-space: nowrap;
}

.ss-sidebar-toggle {
  display: none;
  border: none;
  background: none;
  cursor: pointer;
  color: #666;
  padding: 4px;
  border-radius: 4px;
}

.ss-sidebar-toggle:hover {
  background: #e9ecef;
}

.ss-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.ss-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #888;
  white-space: nowrap;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ss-legend-item:hover {
  color: #666;
  background: rgba(25, 118, 210, 0.04);
}

.ss-legend-item.active {
  color: #333;
  border-color: #e0e0e0;
  background: rgba(25, 118, 210, 0.08);
}

.ss-legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ss-modified-icon {
  font-size: 11px;
  color: #f59e0b;
  opacity: 0.7;
}

.ss-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.ss-select {
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  color: #333;
  outline: none;
  cursor: pointer;
}

.ss-select:focus { border-color: #1976d2; }

.ss-search-input {
  width: 130px;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  color: #333;
  outline: none;
}

.ss-search-input:focus { border-color: #1976d2; }
.ss-search-input::placeholder { color: #bbb; }

.ss-tag-select {
  position: relative;
}

.ss-tag-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: nowrap;
  min-width: 100px;
  max-width: 200px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 4px;
  background: #fff;
}

.ss-tag-chips:focus-within {
  border-color: #1976d2;
}

.ss-tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: #e3f2fd;
  color: #1976d2;
  white-space: nowrap;
}

.ss-tag-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: none;
  background: none;
  color: #1976d2;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  opacity: 0.6;
}

.ss-tag-chip-remove:hover {
  opacity: 1;
}

.ss-tag-input {
  flex: 1;
  min-width: 30px;
  border: none;
  outline: none;
  font-size: 12px;
  padding: 2px 0;
  background: none;
  color: #333;
}

.ss-tag-input::placeholder {
  color: #bbb;
}

.ss-tag-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 2px;
  min-width: 120px;
  max-height: 200px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 20;
}

.ss-tag-dropdown-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  text-align: left;
  font-size: 12px;
  color: #333;
  cursor: pointer;
}

.ss-tag-dropdown-item:hover {
  background: #e3f2fd;
  color: #1976d2;
}

.ss-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
  margin-top: 12px;
}

.ss-mobile-backdrop { display: none; }

.ss-sidebar {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ss-loading {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  color: #999;
}

.ss-empty-list {
  padding: 24px 16px;
  font-size: 13px;
  color: #999;
  text-align: center;
}

.ss-category-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.ss-category {
  margin-bottom: 2px;
}

.ss-category-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ss-category-header:hover {
  background: #f0f0f0;
}

.ss-cat-arrow {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}

.ss-cat-arrow.collapsed {
  transform: rotate(-90deg);
}

.ss-cat-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
  font-weight: 500;
  font-size: 13px;
  color: #333;
}

.ss-cat-count {
  font-size: 11px;
  color: #888;
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 8px;
}

.ss-category-skills {
  padding: 2px 0 4px;
}

.ss-skill-item {
  display: block;
  width: 100%;
  padding: 6px 10px 6px 28px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.ss-skill-item:hover {
  background: #f0f0f0;
}

.ss-skill-item.active {
  background: #e3f2fd;
}

.ss-skill-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ss-skill-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
}

.ss-skill-tags-row {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.ss-skill-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #f0f0f0;
  color: #888;
  line-height: 1.4;
}

.ss-sidebar-footer {
  padding: 8px;
  border-top: 1px solid #e0e0e0;
}

.ss-import-btn {
  width: 100%;
  padding: 6px;
  border: 1px dashed #bbb;
  border-radius: 6px;
  background: none;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ss-import-btn:hover {
  border-color: #1976d2;
  color: #1976d2;
  background: #e3f2fd;
}

.ss-main {
  flex: 1;
  overflow-y: auto;
  padding: 0 20px;
  min-width: 0;
}

.ss-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #999;
  font-size: 13px;
}

.ss-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ss-detail-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

.ss-detail-category {
  font-size: 13px;
  color: #888;
}

.ss-detail-sep { color: #ccc; }

.ss-detail-name {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.ss-detail-tags {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.ss-detail-tag-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: #e3f2fd;
  color: #1976d2;
}

.ss-detail-body {
  flex: 1;
  min-height: 0;
}

.ss-detail-md pre {
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  margin: 0;
}

.ss-detail-files {
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ss-file-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ss-file-group-label {
  font-size: 11px;
  font-weight: 600;
  color: #999;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.ss-file-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ss-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: #fafafa;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ss-file-chip:hover {
  border-color: #1976d2;
  color: #1976d2;
  background: #e3f2fd;
}

.ss-file-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ss-file-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.ss-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  color: #1976d2;
  font-size: 13px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.ss-back-btn:hover { background: #e3f2fd; }

.ss-file-name {
  font-size: 13px;
  color: #666;
}

.ss-file-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.ss-file-body {
  background: #f8f9fa;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 16px;
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  margin: 0;
}

@media (max-width: 768px) {
  .ss-legend { display: none; }
  .ss-header-actions { gap: 4px; }
  .ss-search-input { width: 100px; }
  .ss-sidebar-toggle { display: flex; }
  .ss-sidebar {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    z-index: 10;
    background: #fff;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  }
  .ss-body { position: relative; }
  .ss-mobile-backdrop {
    display: block;
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 9;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  .ss-mobile-backdrop.active {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
