import type { ToolModule } from '../types.js'

export const tool: ToolModule = {
  name: 'delegate_task',
  description: '委托子任务给同组 sub 角色',
  parameters: {
    type: 'object',
    properties: {
      task: { type: 'string', description: '子任务描述' },
      target_character_id: { type: 'string', description: '目标角色 ID' },
      sub_strategy: { type: 'string', enum: ['Plan', 'Ask', 'Bypass'], description: '子任务策略（可选，默认继承）' },
      instances: { type: 'number', description: '并发实例数（可选，默认 1）' },
    },
    required: ['task', 'target_character_id'],
  },
  dangerous: true,
  signal: true,
  execute: async () => {
    return { output: '', error: 'delegate_task is a signal tool handled at loop level' }
  },
}
