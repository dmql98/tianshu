import { createRouter, createWebHashHistory } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import ChatView from '@/views/ChatView.vue'
import SettingsView from '@/components/settings/SettingsView.vue'
import RoleView from '@/views/RoleView.vue'
import SkillView from '@/views/SkillView.vue'
import ToolView from '@/views/ToolView.vue'
import EventsView from '@/views/EventsView.vue'
import MarketView from '@/views/MarketView.vue'
import McpView from '@/views/McpView.vue'
import NotFound from '@/views/NotFound.vue'

const PERSIST_KEY = 'tianshu-chat-defaults'

function loadPersistedDefaults() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, string>
  } catch { return {} }
}

const router = createRouter({
  // Electron loads the client from file:// (via loadFile), where the page
  // pathname is the absolute file path and HTML5 history routing resolves to
  // a 404 on first launch. Hash history keeps the route in the URL fragment so
  // the initial load matches "/" and redirects to the chat view.
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/c',
    },
    {
      path: '/c',
      name: 'chat',
      component: ChatView,
    },
    {
      path: '/c/:id',
      name: 'chat-session',
      component: ChatView,
    },
    {
      path: '/c/:id/files',
      name: 'chat-files',
      component: ChatView,
    },
    {
      path: '/c/:id/outline',
      name: 'chat-outline',
      component: ChatView,
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
    {
      path: '/settings/:tab',
      name: 'settings-tab',
      component: SettingsView,
    },
    {
      path: '/role',
      name: 'role',
      component: RoleView,
    },
    {
      path: '/skill',
      name: 'skill',
      component: SkillView,
    },
    {
      path: '/tool',
      name: 'tool',
      component: ToolView,
    },
    {
      path: '/events',
      name: 'events',
      component: EventsView,
    },
    {
      path: '/market',
      name: 'market',
      component: MarketView,
    },
    {
      path: '/mcp',
      name: 'mcp',
      component: McpView,
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFound,
    },
  ],
})

router.beforeEach(async (to) => {
  if (to.path === '/' || to.path.startsWith('/c')) {
    const chatStore = useChatStore()
    if (chatStore.sessions.length === 0) {
      await chatStore.loadSessions()
    }
    if (to.path === '/' || to.path === '/c') {
      const saved = loadPersistedDefaults()
      if (saved.activeSessionId && chatStore.sessions.find(s => s.id === saved.activeSessionId)) {
        return { path: `/c/${saved.activeSessionId}`, replace: true }
      }
      if (chatStore.sessions.length > 0) {
        return { path: `/c/${chatStore.sessions[0].id}`, replace: true }
      }
      const s = await chatStore.createSession()
      return { path: `/c/${s.id}`, replace: true }
    }
  }
})

export default router
