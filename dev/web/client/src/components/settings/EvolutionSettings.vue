<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCharactersStore } from '@/stores/characters'
import { useProvidersStore } from '@/stores/providers'
import SettingRow from './SettingRow.vue'
import { fetchEvolutionConfig, saveEvolutionConfig, clearEvolutionConfig } from '@/api/evolution'

const { t } = useI18n()
const charactersStore = useCharactersStore()
const providersStore = useProvidersStore()

const characterId = ref('')
const groupId = ref('')
const providerId = ref('')
const model = ref('')
const workspace = ref('')
const content = ref('')
const detectWindow = ref(8)
const errorRateThreshold = ref(0.5)
const repetitionCount = ref(3)
const highFreqMinCalls = ref(6)
const highFreqMaxUnique = ref(2)
const notifyEnabled = ref(true)
const notifyTimeout = ref(2)

onMounted(async () => {
  await Promise.all([
    charactersStore.load(),
    providersStore.load(),
    loadConfig(),
  ])
})

async function loadConfig() {
  try {
    const config = await fetchEvolutionConfig()
    characterId.value = config.character_id || ''
    groupId.value = config.group_id || ''
    providerId.value = config.provider_id || ''
    model.value = config.model || ''
    workspace.value = config.workspace || ''
    content.value = config.content || ''
    detectWindow.value = config.detect_window ?? 8
    errorRateThreshold.value = config.error_rate_threshold ?? 0.5
    repetitionCount.value = config.repetition_count ?? 3
    highFreqMinCalls.value = config.high_freq_min_calls ?? 6
    highFreqMaxUnique.value = config.high_freq_max_unique ?? 2
    notifyEnabled.value = config.notify_enabled ?? true
    notifyTimeout.value = config.notify_timeout ?? 2
  } catch (err) {
    console.error('Failed to load evolution config:', err)
  }
}

const availableChars = computed(() =>
  charactersStore.characters
)

const selectedCharGroups = computed(() => {
  if (!characterId.value) return []
  const c = charactersStore.characters.find(x => x.id === characterId.value)
  return c?.groups?.filter(g => g.trim()) || []
})

const selectedProviderModels = computed(() => {
  if (!providerId.value) return []
  const p = providersStore.providers.find(x => x.id === providerId.value)
  return p?.models?.filter((m: any) => m.enabled !== false) || []
})

async function save() {
  try {
    await saveEvolutionConfig({
      character_id: characterId.value,
      group_id: groupId.value,
      provider_id: providerId.value,
      model: model.value,
      workspace: workspace.value,
      content: content.value,
      detect_window: detectWindow.value,
      error_rate_threshold: errorRateThreshold.value,
      repetition_count: repetitionCount.value,
      high_freq_min_calls: highFreqMinCalls.value,
      high_freq_max_unique: highFreqMaxUnique.value,
      notify_enabled: notifyEnabled.value,
      notify_timeout: notifyTimeout.value,
    })
  } catch (err) {
    console.error('Failed to save evolution config:', err)
  }
}

function resetTriggerDefaults() {
  detectWindow.value = 8
  errorRateThreshold.value = 0.5
  repetitionCount.value = 3
  highFreqMinCalls.value = 6
  highFreqMaxUnique.value = 2
  save()
}

async function clear() {
  characterId.value = ''
  groupId.value = ''
  providerId.value = ''
  model.value = ''
  workspace.value = ''
  content.value = ''
  detectWindow.value = 8
  errorRateThreshold.value = 0.5
  repetitionCount.value = 3
  highFreqMinCalls.value = 6
  highFreqMaxUnique.value = 2
  notifyEnabled.value = true
  notifyTimeout.value = 2
  try {
    await clearEvolutionConfig()
  } catch (err) {
    console.error('Failed to clear evolution config:', err)
  }
}
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('event.evolution') }}</h3>
    <p class="section-desc">{{ t('event.evolutionDesc') }}</p>

    <SettingRow :label="t('event.evolutionChar')" :hint="t('event.evolutionCharHint')">
        <select v-model="characterId" class="setting-select" @change="save">
          <option value="">无</option>
          <option v-for="c in availableChars" :key="c.id" :value="c.id">{{ c.name }} ({{ c.id }})</option>
        </select>
      </SettingRow>

      <SettingRow :label="t('event.evolutionGroup')" :hint="t('event.evolutionGroupHint')">
        <select v-model="groupId" class="setting-select" :disabled="selectedCharGroups.length === 0" @change="save">
          <option value="">无</option>
          <option v-for="g in selectedCharGroups" :key="g" :value="g">{{ g }}</option>
        </select>
      </SettingRow>

      <SettingRow :label="t('event.evolutionProvider')" :hint="t('event.evolutionProviderHint')">
        <select v-model="providerId" class="setting-select" @change="save">
          <option value="">无</option>
          <option v-for="p in providersStore.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </SettingRow>

      <SettingRow :label="t('event.evolutionModel')" :hint="t('event.evolutionModelHint')">
        <select v-model="model" class="setting-select" :disabled="!providerId" @change="save">
          <option value="">无</option>
          <option v-for="m in selectedProviderModels" :key="m.id" :value="m.id">{{ m.name || m.id }}</option>
        </select>
      </SettingRow>

      <SettingRow :label="t('event.evolutionWorkspace')" :hint="t('event.evolutionWorkspaceHint')">
        <input v-model="workspace" class="setting-input-wide" placeholder="/path/to/workspace" @change="save" />
      </SettingRow>

      <SettingRow :label="t('event.evolutionContent')" :hint="t('event.evolutionContentHint')">
        <textarea v-model="content" class="setting-textarea" rows="4" :placeholder="t('event.evolutionContentPlaceholder')" @change="save" />
      </SettingRow>

      <h4 class="subsection-title">触发条件（任一条件满足触发）</h4>
      <button class="btn btn-reset" @click="resetTriggerDefaults">恢复默认值</button>

      <div class="detect-table">
        <div class="detect-row">
          <span class="detect-type">自我修正（self_correction）</span>
          <span class="detect-condition">
            近 <input v-model.number="detectWindow" type="number" class="detect-input" min="2" max="50" @change="save" />
            次调用错误率 &gt; <input v-model.number="errorRateThreshold" type="number" class="detect-input" min="0.1" max="1" step="0.05" @change="save" />
          </span>
          <span class="detect-desc">发现 agent 在试错/探索</span>
        </div>
        <div class="detect-row">
          <span class="detect-type">重复模式（repeated_pattern）</span>
          <span class="detect-condition">
            同一工具序列重复 <input v-model.number="repetitionCount" type="number" class="detect-input" min="2" max="20" @change="save" />+ 次
          </span>
          <span class="detect-desc">发现死循环或固化模式</span>
        </div>
        <div class="detect-row">
          <span class="detect-type">高频使用（high_frequency）</span>
          <span class="detect-condition">
            <input v-model.number="highFreqMinCalls" type="number" class="detect-input" min="3" max="50" @change="save" />+ 次调用中仅用 1-<input v-model.number="highFreqMaxUnique" type="number" class="detect-input" min="1" max="10" @change="save" /> 种工具
          </span>
          <span class="detect-desc">发现工具使用过于集中</span>
        </div>
      </div>

      <h4 class="subsection-title">通知</h4>

      <SettingRow label="创建进化时提醒" hint="检测到进化信号创建事件时右下角弹提示">
        <label class="switch">
          <input type="checkbox" v-model="notifyEnabled" @change="save" />
          <span class="switch-slider"></span>
        </label>
      </SettingRow>

      <SettingRow label="提示消失时间" :hint="'默认 ' + notifyTimeout + ' 秒'">
        <input v-model.number="notifyTimeout" type="number" class="detect-input" min="1" max="30" @change="save" /> 秒
      </SettingRow>

    <div class="form-actions">
      <button class="btn btn-primary" @click="save">{{ t('common.save') }}</button>
      <button class="btn" @click="clear">清除</button>
    </div>
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
.setting-select {
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  min-width: 160px;
}
.setting-select:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}
.setting-input-wide {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  box-sizing: border-box;
}
.subsection-title {
  font-size: 15px;
  font-weight: 600;
  margin: 20px 0 12px;
  padding-top: 12px;
  border-top: 1px solid #eee;
}
.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}
.switch input { opacity: 0; width: 0; height: 0; }
.switch-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background: #ccc;
  border-radius: 20px;
  transition: .3s;
}
.switch-slider::before {
  content: '';
  position: absolute;
  height: 16px; width: 16px;
  left: 2px; bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: .3s;
}
.switch input:checked + .switch-slider { background: #1976d2; }
.switch input:checked + .switch-slider::before { transform: translateX(16px); }
.detect-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}
.detect-row {
  display: grid;
  grid-template-columns: 160px 1fr 200px;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background: #fafafa;
  font-size: 13px;
}
.detect-type {
  font-family: monospace;
  font-weight: 600;
  color: #1976d2;
}
.detect-condition {
  color: #333;
}
.detect-desc {
  color: #888;
  font-size: 12px;
}
.detect-input {
  width: 56px;
  padding: 3px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  text-align: center;
  margin: 0 2px;
}
.setting-textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
}
.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.btn {
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.btn-primary {
  background: #007aff;
  color: #fff;
}
.btn-reset {
  font-size: 12px;
  padding: 3px 10px;
  margin-bottom: 8px;
}
.btn:hover:not(.btn-primary) {
  background: #f0f0f0;
}
</style>
