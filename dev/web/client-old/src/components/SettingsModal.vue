<script setup lang="ts">
import { ref } from 'vue'
import { useProvidersStore } from '@/stores/providers'

const emit = defineEmits<{ close: [] }>()
const store = useProvidersStore()
const editing = ref<{ id?: string; name: string; base_url: string; api_key: string; model_id: string; model_name: string }>({
  name: '', base_url: '', api_key: '', model_id: '', model_name: '',
})

function editProvider(p: any) {
  editing.value = {
    id: p.id, name: p.name, base_url: p.base_url, api_key: p.api_key,
    model_id: p.models[0]?.id || '', model_name: p.models[0]?.name || '',
  }
}
function newProvider() {
  editing.value = { name: '', base_url: '', api_key: '', model_id: '', model_name: '' }
}
async function save() {
  const models = editing.value.model_id ? [{ id: editing.value.model_id, name: editing.value.model_name || editing.value.model_id }] : []
  if (editing.value.id) {
    await store.update(editing.value.id, { name: editing.value.name, base_url: editing.value.base_url, api_key: editing.value.api_key, models })
  } else {
    await store.create({ name: editing.value.name, base_url: editing.value.base_url, api_key: editing.value.api_key, models })
  }
  editing.value = { name: '', base_url: '', api_key: '', model_id: '', model_name: '' }
}
async function remove(id: string) {
  if (confirm('Delete this provider?')) await store.remove(id)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>Provider Settings</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
      <div class="modal-body">
        <div v-for="p in store.providers" :key="p.id" class="provider-row">
          <div class="provider-info">
            <strong>{{ p.name }}</strong>
            <span class="url">{{ p.base_url }}</span>
          </div>
          <button @click="editProvider(p)">Edit</button>
          <button @click="remove(p.id)" v-if="!p.builtIn">Delete</button>
        </div>
        <button class="add-btn" @click="newProvider">+ Add Provider</button>
        <div v-if="editing.name || editing.base_url" class="edit-form">
          <input v-model="editing.name" placeholder="Provider name" />
          <input v-model="editing.base_url" placeholder="Base URL" />
          <input v-model="editing.api_key" placeholder="API Key" type="password" />
          <input v-model="editing.model_id" placeholder="Model ID (e.g. deepseek-v4-flash)" />
          <input v-model="editing.model_name" placeholder="Model name (display)" />
          <button @click="save">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
.modal { background: white; border-radius: 12px; width: 500px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
.modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #eee; }
.modal-body { padding: 16px 20px; }
.provider-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
.provider-info { flex: 1; }
.provider-info .url { font-size: 12px; color: #666; display: block; }
.add-btn, .edit-form { margin-top: 12px; }
.edit-form input { display: block; width: 100%; padding: 6px; margin-bottom: 6px; border: 1px solid #ccc; border-radius: 4px; }
.close-btn { background: none; border: none; font-size: 18px; cursor: pointer; }
</style>
