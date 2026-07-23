<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolBinding, ToolConstraint } from '@/api/characters'
import type { ConstraintField } from '@/api/tools'

export interface ToolItem {
  name: string
  description: string
  source: 'builtin' | 'mcp' | 'external'
  constraintFields?: ConstraintField[]
}

const props = defineProps<{
  modelValue?: ToolBinding[] | null
  allTools?: ToolItem[] | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: ToolBinding[]): void }>()

const localList = computed<ToolBinding[]>(() => props.modelValue || [])

const expanded = ref<Record<string, boolean>>({})

function toolBindingName(tool: ToolItem): string {
  return tool.source === 'mcp' ? `mcp:${tool.name}` : tool.name
}

function isEnabled(name: string): boolean {
  return localList.value.some(t => t.name === name)
}

function toggleTool(tool: ToolItem) {
  const toolName = tool.source === 'mcp' ? `mcp:${tool.name}` : tool.name
  const list = [...localList.value]
  const idx = list.findIndex(t => t.name === toolName)
  if (idx >= 0) {
    list.splice(idx, 1)
  } else {
    list.push({ name: toolName })
  }
  emit('update:modelValue', list)
}

function getBinding(name: string): ToolBinding | undefined {
  return localList.value.find(t => t.name === name)
}

function getConstraint(name: string): ToolConstraint {
  const b = getBinding(name)
  return b?.constraints || {}
}

function setConstraint(name: string, key: string, value: any) {
  const list = [...localList.value]
  const idx = list.findIndex(t => t.name === name)
  if (idx < 0) return
  const b = { ...list[idx] }
  const c = { ...(b.constraints || {}) }
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
    delete (c as any)[key]
  } else {
    (c as any)[key] = value
  }
  b.constraints = Object.keys(c).length > 0 ? c : undefined
  list[idx] = b
  emit('update:modelValue', list)
}

function inputVal(field: ConstraintField, toolName: string): any {
  const c = getConstraint(toolName) as any
  const raw = c[field.key]
  if (field.type === 'string-list') return (raw || []).join(', ')
  return raw ?? ''
}

function onInput(field: ConstraintField, toolName: string, raw: string) {
  if (field.type === 'string-list') {
    const arr = raw.split(',').map(s => s.trim()).filter(Boolean)
    setConstraint(toolName, field.key, arr.length > 0 ? arr : undefined)
  } else {
    setConstraint(toolName, field.key, raw || undefined)
  }
}

function boolVal(field: ConstraintField, toolName: string): boolean {
  return !!((getConstraint(toolName) as any)[field.key])
}

function onBool(field: ConstraintField, toolName: string, checked: boolean) {
  setConstraint(toolName, field.key, checked || undefined)
}
</script>

<template>
  <div class="tool-binding-editor">
    <div class="tools-grid">
      <div v-for="tool in allTools || []" :key="tool.name" class="tool-card" :class="{ enabled: isEnabled(toolBindingName(tool)) }">
        <div class="tool-row">
          <span class="tool-name">{{ tool.name }}</span>
          <span :class="['tool-source', `tool-source--${tool.source}`]">
            {{ tool.source === 'builtin' ? '内置' : tool.source === 'mcp' ? 'MCP' : '外部导入' }}
          </span>
          <label class="toggle-label-wrap">
            <input type="checkbox" :checked="isEnabled(toolBindingName(tool))" @change="toggleTool(tool)" class="toggle-input" />
            <span class="toggle-switch"></span>
          </label>
          <button v-if="isEnabled(toolBindingName(tool)) && tool.constraintFields?.length" class="expand-btn" @click="expanded[toolBindingName(tool)] = !expanded[toolBindingName(tool)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline v-if="!expanded[toolBindingName(tool)]" points="6 9 12 15 18 9" />
              <polyline v-else points="18 15 12 9 6 15" />
            </svg>
            {{ expanded[toolBindingName(tool)] ? '收起' : '约束' }}
          </button>
        </div>
        <div v-if="isEnabled(toolBindingName(tool)) && expanded[toolBindingName(tool)]" class="constraints-panel">
          <div v-for="field in tool.constraintFields || []" :key="field.key" class="constraint-field">
            <div v-if="field.type === 'boolean'" class="boolean-field">
              <label class="toggle-row">
                <span class="toggle-label">{{ field.label }}</span>
                <input type="checkbox" :checked="boolVal(field, toolBindingName(tool))" @change="onBool(field, toolBindingName(tool), ($event.target as HTMLInputElement).checked)" class="toggle-input" />
                <span class="toggle-switch"></span>
              </label>
            </div>
            <template v-else>
              <label class="constraint-label">{{ field.label }}</label>
              <input
                class="constraint-input"
                :type="field.type === 'number' ? 'number' : 'text'"
                :placeholder="field.placeholder || ''"
                :value="inputVal(field, toolBindingName(tool))"
                @input="onInput(field, toolBindingName(tool), ($event.target as HTMLInputElement).value)"
              />
            </template>
          </div>
        </div>
      </div>
    </div>
    <p class="tools-hint">勾选 = 启用该工具。展开约束可设置路径/大小/命令限制。</p>
  </div>
</template>

<style scoped>
.tool-binding-editor { border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
.tools-grid { display: flex; flex-direction: column; }
.tool-card { border-bottom: 1px solid #f0f0f0; }
.tool-card:last-child { border-bottom: none; }
.tool-card.enabled { background: #fafcff; }
.tool-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
}
.tool-name {
  flex: 1; font-size: 13px; font-family: 'SF Mono', 'Consolas', monospace; color: #555;
}
.expand-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 8px; border: 1px solid #ddd; border-radius: 4px;
  background: #fff; cursor: pointer; font-size: 11px; color: #888;
}
.expand-btn:hover { border-color: #1976d2; color: #1976d2; }
.tool-source {
  font-size: 10px; padding: 1px 6px; border-radius: 3px;
  font-weight: 500; white-space: nowrap; flex-shrink: 0;
}
.tool-source--builtin { background: #e8f5e9; color: #388e3c; }
.tool-source--mcp { background: #e3f2fd; color: #1976d2; }
.tool-source--external { background: #fff3e0; color: #e65100; }
.constraints-panel {
  padding: 0 12px 10px 24px; display: flex; flex-direction: column; gap: 6px;
}
.constraint-field { display: flex; flex-direction: column; gap: 2px; }
.constraint-label { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; letter-spacing: 0.3px; }
.constraint-input {
  width: 100%; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;
  font-size: 12px; outline: none; box-sizing: border-box; font-family: 'SF Mono', 'Consolas', monospace;
}
.constraint-input:focus { border-color: #1976d2; }
.toggle-row {
  display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 2px 0;
}
.toggle-label { font-size: 12px; color: #555; }
.toggle-input { display: none; }
.toggle-label-wrap { display: inline-flex; align-items: center; cursor: pointer; }
.toggle-switch {
  position: relative; width: 28px; height: 16px; background: #ccc;
  border-radius: 8px; transition: background 0.2s; flex-shrink: 0;
}
.toggle-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; background: #fff; border-radius: 50%; transition: transform 0.2s;
}
.toggle-input:checked + .toggle-switch { background: #1976d2; }
.toggle-input:checked + .toggle-switch::after { transform: translateX(12px); }
.tools-hint { padding: 6px 12px 8px; font-size: 11px; color: #aaa; margin: 0; border-top: 1px solid #f0f0f0; }
</style>
