<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import SearchBar from './Sidebar/SearchBar.vue'
import FilterBar from './Sidebar/FilterBar.vue'
import WorkspaceGroup from './Sidebar/WorkspaceGroup.vue'
import BatchActions from './Sidebar/BatchActions.vue'
import { useChatStore } from '@/stores/chat'

const router = useRouter()
const chatStore = useChatStore()

const searchQuery = ref('')
const filterType = ref<'all' | 'starred'>('all')

const filteredWorkspaces = computed(() => {
  let groups = chatStore.workspaceGroups
  if (filterType.value === 'starred') {
    groups = groups.map(g => ({
      ...g,
      sessions: g.sessions.filter(s => s.pinned),
    })).filter(g => g.sessions.length > 0)
  }
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    groups = groups.map(g => ({
      ...g,
      sessions: g.sessions.filter(s => s.title.toLowerCase().includes(q)),
    })).filter(g => g.sessions.length > 0)
  }
  return groups
})

function handleSearch(value: string) {
  searchQuery.value = value
}

function handleFilter(type: 'all' | 'starred') {
  filterType.value = type
}

function openSession(id: string) {
  router.push(`/c/${id}`)
}

function newSession() {
  chatStore.createSession().then(s => router.push(`/c/${s.id}`))
}
</script>

<template>
  <aside class="sidebar">
    <SearchBar @search="handleSearch" />
    <FilterBar :active-filter="filterType" @filter="handleFilter" />
    <div class="session-list">
      <div class="session-list-header">
        <span class="title">Sessions</span>
        <button class="new-btn" @click="newSession">+</button>
        <button class="batch-btn" @click="chatStore.toggleBatchMode()">批量</button>
      </div>
      <WorkspaceGroup
        v-for="group in filteredWorkspaces"
        :key="group.name"
        :workspace="group"
        @select="openSession"
      />
    </div>
    <BatchActions v-if="chatStore.isBatchMode" />
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px; min-width: 260px;
  display: flex; flex-direction: column;
  border-right: 1px solid #e0e0e0;
  background: #f8f9fa;
}
.sidebar-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 12px 10px;
  border-bottom: 1px solid #e0e0e0;
}
.logo { width: 28px; height: 28px; border-radius: 6px; }
.app-name { font-size: 16px; font-weight: 700; }
.session-list { flex: 1; overflow-y: auto; padding: 8px; }
.session-list-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 0 8px; }
.title { font-weight: 600; font-size: 14px; }
.new-btn, .batch-btn { background: none; border: 1px solid #ccc; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.batch-btn { color: #007aff; }
</style>
