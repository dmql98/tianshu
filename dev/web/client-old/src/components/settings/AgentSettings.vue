<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()

const maxTurns = ref(30)
const gatewayTimeout = ref(300)
const restartDrainTimeout = ref(60)
const toolEnforcement = ref('auto')
const autoApproveTools = ref(false)

const enforcementOptions = [
  { label: 'Auto', value: 'auto' },
  { label: 'Always', value: 'always' },
  { label: 'Never', value: 'never' },
]
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('agent.title') }}</h3>
    <p class="section-desc">{{ t('agent.desc') }}</p>

    <SettingRow :label="t('agent.maxTurns')" :hint="t('agent.maxTurnsHint')">
      <input v-model.number="maxTurns" type="number" min="1" max="200" step="5" class="input-number" />
    </SettingRow>

    <SettingRow :label="t('agent.gatewayTimeout')" :hint="t('agent.gatewayTimeoutHint')">
      <input v-model.number="gatewayTimeout" type="number" min="60" max="7200" step="60" class="input-number" />
    </SettingRow>

    <SettingRow :label="t('agent.drainTimeout')" :hint="t('agent.drainTimeoutHint')">
      <input v-model.number="restartDrainTimeout" type="number" min="10" max="300" step="10" class="input-number" />
    </SettingRow>

    <SettingRow :label="t('agent.toolEnforcement')" :hint="t('agent.toolEnforcementHint')">
      <select v-model="toolEnforcement" class="input-select">
        <option v-for="opt in enforcementOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </SettingRow>

    <SettingRow :label="t('agent.autoApprove')" :hint="t('agent.autoApproveHint')">
      <label class="switch">
        <input v-model="autoApproveTools" type="checkbox" />
        <span class="switch-slider"></span>
      </label>
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

.input-number {
  width: 100px;
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  text-align: center;
}

.input-number:focus {
  border-color: #1976d2;
}

.input-select {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  min-width: 120px;
}

.input-select:focus {
  border-color: #1976d2;
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
</style>
