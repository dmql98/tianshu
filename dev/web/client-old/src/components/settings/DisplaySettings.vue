<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { i18n, setLocale } from '@/i18n'
import SettingRow from './SettingRow.vue'

const { t } = useI18n()

const brightness = ref('system')

const themeOptions = computed(() => [
  { label: t('common.light'), value: 'light' },
  { label: t('common.dark'), value: 'dark' },
  { label: t('common.system'), value: 'system' },
])

const langOptions = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
]

function onLangChange(e: Event) {
  setLocale((e.target as HTMLSelectElement).value)
}
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('display.title') }}</h3>
    <p class="section-desc">{{ t('display.desc') }}</p>

    <SettingRow :label="t('display.language')" :hint="t('display.languageHint')">
      <select :value="i18n.global.locale" class="input-select" @change="onLangChange">
        <option v-for="opt in langOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </SettingRow>

    <SettingRow :label="t('display.theme')" :hint="t('display.themeHint')">
      <select v-model="brightness" class="input-select">
        <option v-for="opt in themeOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
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
</style>
