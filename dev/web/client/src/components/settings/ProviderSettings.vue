<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProvidersStore } from '@/stores/providers'

const { t } = useI18n()
const store = useProvidersStore()

const fetchingModels = ref<string | null>(null)
const editingProvider = ref<{
  id?: string
  name: string
  base_url: string
  api_key: string
} | null>(null)

function isCustom(p: { builtIn?: boolean }) {
  return !p.builtIn
}

function ensureModelEnabled(p: any) {
  if (!p.models) p.models = []
  p.models.forEach((m: any) => { if (m.enabled === undefined) m.enabled = true })
}

function isModelEnabled(p: any, modelId: string) {
  ensureModelEnabled(p)
  return p.models.find((m: any) => m.id === modelId)?.enabled !== false
}

function toggleModel(p: any, modelId: string) {
  ensureModelEnabled(p)
  const m = p.models.find((m: any) => m.id === modelId)
  if (m) m.enabled = !m.enabled
}

async function handleFetchModels(id: string) {
  fetchingModels.value = id
  try {
    await store.fetchModels(id)
  } finally {
    fetchingModels.value = null
  }
}

function editProvider(p: any) {
  editingProvider.value = {
    id: p.id,
    name: p.name,
    base_url: p.base_url,
    api_key: p.api_key,
  }
}

function newProvider() {
  editingProvider.value = {
    name: '', base_url: '', api_key: '',
  }
}

async function saveProvider() {
  if (!editingProvider.value) return
  const e = editingProvider.value
  const p = store.providers.find(x => x.id === e.id)
  const enabled = p ? p.models.filter((m: any) => m.enabled !== false).map((m: any) => ({ id: m.id, name: m.name || m.id })) : []
  if (e.id) {
    await store.update(e.id, { name: e.name, base_url: e.base_url, api_key: e.api_key, models: enabled })
  } else {
    await store.create({ name: e.name, base_url: e.base_url, api_key: e.api_key, models: [] })
  }
  editingProvider.value = null
}

function cancelEdit() {
  editingProvider.value = null
}

async function removeProvider(id: string) {
  if (confirm('Delete this provider?')) await store.remove(id)
}
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">{{ t('provider.title') }}</h3>
    <p class="section-desc">{{ t('provider.desc') }}</p>

    <div v-for="p in store.providers" :key="p.id" class="provider-section">
      <div class="provider-header">
        <h4 class="provider-name">{{ p.name }}</h4>
        <span :class="['type-badge', isCustom(p) ? 'custom' : 'builtin']">
          {{ isCustom(p) ? t('provider.custom') : t('provider.builtin') }}
        </span>
      </div>

      <div class="provider-info">
        <div class="info-row">
          <span class="info-label">{{ t('provider.url') }}</span>
          <span class="info-value">{{ p.base_url || '—' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">{{ t('provider.api') }}</span>
          <span class="info-value api-key-mask">{{ p.api_key ? '•'.repeat(Math.min(p.api_key.length, 32)) : '—' }}</span>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="models-section">
        <div class="models-header">
          <span class="models-title">
            {{ t('provider.models') }}
            <span v-if="p.models?.length" class="models-count">{{ p.models.length }}</span>
          </span>
          <button
            class="btn-fetch"
            :disabled="fetchingModels === p.id"
            @click="handleFetchModels(p.id)"
          >
            {{ fetchingModels === p.id ? t('provider.fetching') : t('provider.fetch') }}
          </button>
        </div>
        <div class="models-list">
          <div v-if="!p.models?.length" class="models-empty">
            {{ t('provider.noModels') }}
          </div>
          <label
            v-for="m in p.models"
            :key="m.id"
            class="model-item"
          >
            <span class="model-name">{{ m.name || m.id }}</span>
            <span class="model-id">{{ m.id }}</span>
            <span class="model-ctx" :class="{ missing: !m.context_window }">{{ m.context_window ? (m.context_window / 1000).toFixed(0) + 'K' : '未获取' }}</span>
            <input
              type="checkbox"
              :checked="isModelEnabled(p, m.id)"
              class="model-toggle"
              @change="toggleModel(p, m.id)"
            />
          </label>
        </div>
      </div>

      <div v-if="isCustom(p)" class="provider-footer">
        <button class="btn-edit" @click="editProvider(p)">{{ t('provider.edit') }}</button>
        <button class="btn-delete" @click="removeProvider(p.id)">{{ t('provider.delete') }}</button>
      </div>
    </div>

    <button class="btn-add" @click="newProvider">{{ t('provider.addProvider') }}</button>

    <div v-if="editingProvider" class="edit-form-overlay" @click.self="cancelEdit">
      <div class="edit-form">
        <h4 class="form-title">{{ editingProvider.id ? t('provider.editTitle') : t('provider.newTitle') }}</h4>
        <div class="form-group">
          <label>{{ t('provider.nameLabel') }}</label>
          <input v-model="editingProvider.name" placeholder="e.g. My OpenAI" />
        </div>
        <div class="form-group">
          <label>{{ t('provider.urlLabel') }}</label>
          <input v-model="editingProvider.base_url" :placeholder="t('provider.urlPlaceholder')" />
        </div>
        <div class="form-group">
          <label>{{ t('provider.apiKeyLabel') }}</label>
          <input v-model="editingProvider.api_key" type="password" :placeholder="t('provider.apiKeyPlaceholder')" />
        </div>
        <div class="form-actions">
          <button class="btn-primary" @click="saveProvider">{{ t('provider.save') }}</button>
          <button class="btn-cancel" @click="cancelEdit">{{ t('provider.cancel') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-section {
  max-width: 680px;
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

.provider-section {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  background: #fafafa;
}

.provider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.provider-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}

.type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}

.type-badge.builtin {
  background: #e3f2fd;
  color: #1976d2;
}

.type-badge.custom {
  background: #e8f5e9;
  color: #2e7d32;
}

.provider-info {
  background: #fff;
  border-radius: 6px;
  border: 1px solid #f0f0f0;
  overflow: hidden;
}

.info-row {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
}

.info-row + .info-row {
  border-top: 1px solid #f5f5f5;
}

.info-label {
  font-size: 12px;
  font-weight: 600;
  color: #888;
  width: 36px;
  flex-shrink: 0;
}

.info-value {
  color: #333;
  word-break: break-all;
}

.api-key-mask {
  font-family: monospace;
  letter-spacing: 1px;
}

.section-divider {
  height: 1px;
  background: #e0e0e0;
  margin: 14px 0;
}

.models-section {
  background: #fff;
  border-radius: 6px;
  border: 1px solid #f0f0f0;
  overflow: hidden;
}

.models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
}

.models-title {
  font-size: 13px;
  font-weight: 600;
  color: #333;
  display: flex;
  align-items: center;
  gap: 6px;
}

.models-count {
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  background: #1976d2;
  border-radius: 10px;
  padding: 1px 7px;
  min-width: 20px;
  text-align: center;
}

.btn-fetch {
  padding: 4px 12px;
  background: #1976d2;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.btn-fetch:hover {
  background: #1565c0;
}

.btn-fetch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.models-list {
  max-height: 240px;
  overflow-y: auto;
}

.models-empty {
  padding: 16px 12px;
  font-size: 12px;
  color: #999;
  text-align: center;
}

.model-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
  gap: 8px;
}

.model-item:hover {
  background: #f5f9ff;
}

.model-item + .model-item {
  border-top: 1px solid #f5f5f5;
}

.model-name {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  flex: 1;
}

.model-id {
  font-size: 11px;
  color: #999;
}
.model-ctx {
  font-size: 10px; color: #666; background: #f0f0f0;
  padding: 1px 5px; border-radius: 3px; font-weight: 500;
}
.model-ctx.missing { color: #999; background: #f5f5f5; font-weight: 400; font-style: italic; }

.model-toggle {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #1976d2;
}

.provider-footer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e8e8e8;
}

.btn-edit, .btn-delete {
  padding: 5px 14px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  background: #fff;
}

.btn-edit:hover {
  background: #e3f2fd;
  border-color: #90caf9;
}

.btn-delete:hover {
  background: #fce4ec;
  border-color: #ef9a9a;
  color: #d32f2f;
}

.btn-add {
  width: 100%;
  padding: 10px 16px;
  border: 1px dashed #ccc;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  background: none;
  color: #666;
}

.btn-add:hover {
  border-color: #90caf9;
  color: #1976d2;
  background: #f5f9ff;
}

.edit-form-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.edit-form {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  width: 460px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

.form-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 12px;
}

.form-group label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}

.form-group input:focus {
  border-color: #1976d2;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.btn-primary {
  padding: 7px 16px;
  background: #1976d2;
  color: #fff;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary:hover {
  background: #1565c0;
}

.btn-cancel {
  padding: 7px 16px;
  background: #fff;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}

.btn-cancel:hover {
  background: #f5f5f5;
}
</style>
