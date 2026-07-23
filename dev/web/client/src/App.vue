<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProvidersStore } from '@/stores/providers'
import { useCharactersStore } from '@/stores/characters'
import { useChatStore } from '@/stores/chat'
import Sidebar from '@/components/Sidebar.vue'

const chatStore = useChatStore()

const route = useRoute()
const router = useRouter()
const providersStore = useProvidersStore()
const charactersStore = useCharactersStore()

const activeTab = computed(() => {
  const path = route.path
  if (path === '/events') return 'events'
  if (path === '/role') return 'role'
  if (path === '/skill') return 'skill'
  if (path === '/tool') return 'tool'
  if (path === '/mcp') return 'mcp'
  if (path === '/market') return 'market'
  if (path.startsWith('/settings')) return 'settings'
  return 'chat'
})

const showSidebar = computed(() => activeTab.value === 'chat')

onMounted(async () => {
  await Promise.all([
    providersStore.load(),
    charactersStore.load(),
  ])
})

function switchTab(tab: string) {
  switch (tab) {
    case 'chat': router.push('/c'); break
    case 'events': router.push('/events'); break
    case 'role': router.push('/role'); break
    case 'skill': router.push('/skill'); break
    case 'tool': router.push('/tool'); break
    case 'mcp': router.push('/mcp'); break
    case 'market': router.push('/market'); break
    case 'settings': router.push('/settings'); break
  }
}
</script>

<template>
  <div class="app-layout">
    <nav class="nav-tabs">
      <div class="nav-tabs-logo">
        <img src="/yi-logo.png" alt="Yi" class="nav-logo" />
      </div>
      <button
        :class="['nav-tab', { active: activeTab === 'chat' }]"
        @click="switchTab('chat')"
        title="聊天"
      >
        <span class="nav-tab-icon">💬</span>
        <span class="nav-tab-label">聊天</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'events' }]"
        @click="switchTab('events')"
        title="事件"
      >
        <span class="nav-tab-icon">⚡</span>
        <span class="nav-tab-label">事件</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'role' }]"
        @click="switchTab('role')"
        title="角色"
      >
        <span class="nav-tab-icon">🎭</span>
        <span class="nav-tab-label">角色</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'skill' }]"
        @click="switchTab('skill')"
        title="技能"
      >
        <span class="nav-tab-icon">🛠️</span>
        <span class="nav-tab-label">技能</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'tool' }]"
        @click="switchTab('tool')"
        title="工具"
      >
        <span class="nav-tab-icon">🔧</span>
        <span class="nav-tab-label">工具</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'mcp' }]"
        @click="switchTab('mcp')"
        title="MCP"
      >
        <span class="nav-tab-icon">🔗</span>
        <span class="nav-tab-label">MCP</span>
      </button>
      <button
        :class="['nav-tab', { active: activeTab === 'market' }]"
        @click="switchTab('market')"
        title="市场"
      >
        <span class="nav-tab-icon">🏪</span>
        <span class="nav-tab-label">市场</span>
      </button>
      <div class="nav-tabs-spacer"></div>
      <button
        :class="['nav-tab', { active: activeTab === 'settings' }]"
        @click="switchTab('settings')"
        title="设置"
      >
        <span class="nav-tab-icon">⚙️</span>
        <span class="nav-tab-label">设置</span>
      </button>
    </nav>
    <Sidebar v-if="showSidebar" />
    <router-view />
    <Transition name="toast">
      <div v-if="chatStore.evolutionNotification" class="evolution-toast">
        <span class="toast-icon">🧬</span>
        <span>已创建进化事件：会话 {{ chatStore.evolutionNotification.session_id.slice(-8) }}，触发原因：{{ chatStore.evolutionNotification.description }}</span>
      </div>
    </Transition>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; }
.app-layout { display: flex; height: 100%; }
</style>

<style scoped>
.nav-tabs {
  width: 60px;
  min-width: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0 12px;
  background: #2c2c2c;
  gap: 2px;
}

.nav-tabs-spacer {
  flex: 1;
}

.nav-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 48px;
  padding: 8px 0;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #888;
  transition: all 0.15s ease;
}

.nav-tab:hover {
  background: rgba(255,255,255,0.1);
  color: #ddd;
}

.nav-tab.active {
  background: rgba(255,255,255,0.15);
  color: #fff;
}

.nav-tabs-logo {
  width: 60px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.nav-tab-icon {
  font-size: 20px;
  line-height: 1;
}

.nav-tab-label {
  font-size: 10px;
  line-height: 1;
}
.evolution-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: #1976d2;
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  z-index: 9999;
  max-width: 480px;
}
.toast-icon {
  font-size: 18px;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
