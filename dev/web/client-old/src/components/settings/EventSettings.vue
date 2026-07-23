<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GeneralEventSettings from './GeneralEventSettings.vue'
import EvolutionSettings from './EvolutionSettings.vue'

const { t } = useI18n()
const activeSubTab = ref<'general' | 'evolution'>('general')
</script>

<template>
  <div class="event-settings">
    <nav class="sub-tabs">
      <button
        :class="['sub-tab', { active: activeSubTab === 'general' }]"
        @click="activeSubTab = 'general'"
      >{{ t('event.general') }}</button>
      <button
        :class="['sub-tab', { active: activeSubTab === 'evolution' }]"
        @click="activeSubTab = 'evolution'"
      >{{ t('event.evolution') }}</button>
    </nav>
    <div class="sub-tab-content">
      <GeneralEventSettings v-if="activeSubTab === 'general'" />
      <EvolutionSettings v-if="activeSubTab === 'evolution'" />
    </div>
  </div>
</template>

<style scoped>
.event-settings {
  max-width: 640px;
}
.sub-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0;
}
.sub-tab {
  padding: 8px 20px;
  border: none;
  background: none;
  font-size: 14px;
  color: #666;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s ease;
}
.sub-tab:hover {
  color: #333;
}
.sub-tab.active {
  color: #1976d2;
  border-bottom-color: #1976d2;
  font-weight: 500;
}
.sub-tab-content {
  /* content components render their own section */
}
</style>
