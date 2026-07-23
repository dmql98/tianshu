<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()

const blockEventInterrupt = ref(localStorage.getItem('blockEventInterrupt') === 'true')
function toggleBlock() {
  blockEventInterrupt.value = !blockEventInterrupt.value
  localStorage.setItem('blockEventInterrupt', String(blockEventInterrupt.value))
}

const schedulerInterval = ref(localStorage.getItem('eventSchedulerInterval') || '10')
function setSchedulerInterval() {
  localStorage.setItem('eventSchedulerInterval', schedulerInterval.value)
}

const archiveHours = ref(localStorage.getItem('eventArchiveHours') || '24')
function setArchiveHours() {
  localStorage.setItem('eventArchiveHours', archiveHours.value)
}
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('event.title') }}</h3>
    <p class="section-desc">{{ t('event.desc') }}</p>

    <SettingRow :label="t('event.blockInterrupt')" :hint="t('event.blockInterruptHint')">
      <label class="switch">
        <input type="checkbox" :checked="blockEventInterrupt" @change="toggleBlock" />
        <span class="switch-slider"></span>
      </label>
    </SettingRow>

    <SettingRow :label="t('event.schedulerInterval')" :hint="t('event.schedulerIntervalHint')">
      <input type="number" min="1" max="300" class="setting-input" v-model.number="schedulerInterval" @change="setSchedulerInterval" />
    </SettingRow>

    <SettingRow :label="t('event.archiveHours')" :hint="t('event.archiveHoursHint')">
      <input type="number" min="1" max="720" class="setting-input" v-model.number="archiveHours" @change="setArchiveHours" />
    </SettingRow>
  </section>
</template>

<style scoped>
.settings-section {
  max-width: 640px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}

.section-desc {
  font-size: 13px;
  color: #888;
  margin-bottom: 20px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #ccc;
  border-radius: 22px;
  transition: 0.2s;
}

.switch-slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: 0.2s;
}

.switch input:checked + .switch-slider {
  background: #1976d2;
}

.switch input:checked + .switch-slider::before {
  transform: translateX(18px);
}

.setting-input {
  width: 80px;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  text-align: center;
}
</style>
