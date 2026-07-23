<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

const api = computed(() => chatStore.tokenUsage)
const ctx = computed(() => chatStore.contextUsage)
const cacheStats = computed(() => chatStore.activeSession?.cacheStats)
const compacted = computed(() => chatStore.activeSession?.compacted)

const total = computed(() => api.value.input + api.value.output)
const inputPct = computed(() => total.value > 0 ? (api.value.input / total.value) * 100 : 0)
const outputPct = computed(() => total.value > 0 ? (api.value.output / total.value) * 100 : 0)

const R = 8.5
const C = 2 * Math.PI * R
const offset = computed(() => C * (1 - ctx.value.pct / 100))

const statusClass = computed(() => {
  if (ctx.value.pct > 90) return 'danger'
  if (ctx.value.pct > 70) return 'warn'
  return 'good'
})

const visible = computed(() => ctx.value.show || total.value > 0)
const showDetail = ref(false)

function fmt(n: number): string {
  if (n <= 0) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

const tooltip = computed(() => {
  const parts: string[] = []
  if (ctx.value.show) parts.push(`Context: ${fmt(ctx.value.used)}/${fmt(ctx.value.total)} (${ctx.value.pct}%)`)
  if (total.value > 0) {
    parts.push(`In: ${fmt(api.value.input)}`)
    parts.push(`Out: ${fmt(api.value.output)}`)
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="tkbar" v-if="visible" :title="tooltip">
    <div class="tkbar-row" @click="showDetail = !showDetail">
      <svg v-if="ctx.show" width="22" height="22" viewBox="0 0 22 22" class="ring">
        <circle cx="11" cy="11" :r="R" fill="none" stroke="#e8e8e8" stroke-width="3" />
        <circle cx="11" cy="11" :r="R" fill="none" stroke-width="3"
          stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="offset"
          transform="rotate(-90 11 11)" :class="`arc-${statusClass}`" />
      </svg>
      <div v-if="total > 0" class="track">
        <div class="seg seg-in" :style="{ width: inputPct + '%' }" />
        <div class="seg seg-out" :style="{ width: outputPct + '%' }" />
      </div>
      <span class="lbl">
        <template v-if="ctx.show">{{ fmt(ctx.used) }}/{{ fmt(ctx.total) }}</template>
        <template v-if="ctx.show && total > 0"> · </template>
        <template v-if="total > 0">{{ fmt(total) }}</template>
      </span>
      <span v-if="cacheStats" class="cbadge" :class="{ hot: +cacheStats.hitRatio > 50 }">
        {{ cacheStats.hitRatio }}
      </span>
    </div>
    <Transition name="slide">
      <div v-if="showDetail" class="detail">
        <div class="dr">
          <span>上下文</span>
          <span>{{ fmt(ctx.used) }} / {{ fmt(ctx.total) }} ({{ ctx.pct }}%)</span>
        </div>
        <div v-if="total > 0" class="dr">
          <span>本轮</span>
          <span>入 {{ fmt(api.input) }} · 出 {{ fmt(api.output) }}</span>
        </div>
        <div v-if="cacheStats" class="dr">
          <span>缓存</span>
          <span>{{ fmt(cacheStats.hitTokens) }} 命中 / {{ fmt(cacheStats.missTokens) }} 未中 ({{ cacheStats.hitRatio }})</span>
        </div>
        <div v-if="compacted" class="cn">会话已压缩</div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.tkbar {
  padding: 2px 12px; font-size: 10px; color: #888;
  border-top: 1px solid #f0f0f0; user-select: none;
}
.tkbar-row {
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; padding: 2px 0; border-radius: 4px;
}
.tkbar-row:hover { background: #fafafa; }

.ring { flex-shrink: 0; }
.arc-good { stroke: #34c759; }
.arc-warn { stroke: #ff9500; }
.arc-danger { stroke: #ff3b30; }

.track {
  flex: 1; height: 4px; border-radius: 2px; overflow: hidden;
  background: #f0f0f0; display: flex; max-width: 100px;
}
.seg { height: 100%; transition: width 0.2s; }
.seg-in { background: #1976d2; }
.seg-out { background: #43a047; }

.lbl { white-space: nowrap; }
.cbadge {
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  background: #f0f0f0; color: #999; font-weight: 500; margin-left: auto;
}
.cbadge.hot { background: #e8f5e9; color: #2e7d32; }

.detail {
  padding: 6px 8px; background: #fafafa; border-radius: 4px;
  margin-top: 4px; margin-bottom: 2px;
}
.dr {
  display: flex; justify-content: space-between; align-items: center;
  padding: 2px 0; font-size: 11px;
}
.dr span:first-child { color: #999; }
.dr span:last-child { color: #333; font-weight: 500; }
.cn {
  font-size: 10px; color: #8b5cf6; font-weight: 500; margin-top: 2px;
}
.slide-enter-active, .slide-leave-active {
  transition: all 0.15s ease;
}
.slide-enter-from, .slide-leave-to {
  opacity: 0; transform: translateY(-4px);
}
</style>
