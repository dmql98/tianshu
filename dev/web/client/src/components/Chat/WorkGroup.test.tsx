/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { ReactElement } from 'react'
import type { Message } from '@/types'
import WorkGroup from './WorkGroup'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function toolMsg(partial: Partial<Message> & { id: string; timestamp: number }): Message {
  return { role: 'tool', content: '', tool_status: 'success', ...partial }
}

function mount(element: ReactElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => { root.render(element) })
  return {
    host,
    root,
    rerender: (el: ReactElement) => { act(() => { root.render(el) }) },
    unmount: () => {
      act(() => { root.unmount() })
      host.remove()
    },
  }
}

const text = (host: HTMLDivElement) => host.textContent ?? ''

describe('WorkGroup render', () => {
  it('全部完成时默认折叠：组头可见、组内工具行隐藏', () => {
    const items = [
      toolMsg({ id: 't1', timestamp: 1000, tool_name: 'read', tool_status: 'success', tool_duration_ms: 120 } as any),
      toolMsg({ id: 't2', timestamp: 2000, tool_name: 'write', tool_status: 'success', tool_duration_ms: 340 } as any),
    ]
    const r = mount(<WorkGroup items={items} />)
    try {
      expect(r.host.querySelector('.work-group')).not.toBeNull()
      expect(text(r.host)).toContain('已完成')
      expect(text(r.host)).toContain('2 次工具调用')
      // 完成 → 自动折叠：组内工具行不可见
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(0)
      // 完成态显示累计耗时（0.12s + 0.34s = 0.5s 显示 0.5s）
      expect(text(r.host)).toContain('0.5s')
    } finally {
      r.unmount()
    }
  })

  it('存在 running 工具时默认展开：组头「进行中」+ 组内工具行可见', () => {
    const items = [
      toolMsg({ id: 't1', timestamp: 1000, tool_name: 'read', tool_status: 'success', tool_duration_ms: 120 } as any),
      toolMsg({ id: 't2', timestamp: 2000, tool_name: 'write', tool_status: 'running' } as any),
    ]
    const r = mount(<WorkGroup items={items} />)
    try {
      expect(text(r.host)).toContain('进行中')
      expect(r.host.querySelector('.work-group-status')?.className).toContain('running')
      // 运行中 → 默认展开，两条工具行都在
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(2)
    } finally {
      r.unmount()
    }
  })

  it('组内工具行逐个显示状态：成功行与执行中行并存', () => {
    const items = [
      toolMsg({ id: 't1', timestamp: 1000, tool_name: 'read', tool_status: 'success', tool_duration_ms: 120 } as any),
      toolMsg({ id: 't2', timestamp: 2000, tool_name: 'write', tool_status: 'running' } as any),
    ]
    const r = mount(<WorkGroup items={items} />)
    try {
      const rows = Array.from(r.host.querySelectorAll('.tool-invoke'))
      expect(rows.length).toBe(2)
      expect(text(r.host)).toContain('✓ 成功')
      expect(text(r.host)).toContain('执行中...')
      expect(rows[0]!.className).toContain('success')
      expect(rows[1]!.className).toContain('running')
    } finally {
      r.unmount()
    }
  })

  it('运行中变全部完成时自动折叠；手动展开后不被自动折叠覆盖', () => {
    const running = [toolMsg({ id: 't1', timestamp: 1000, tool_name: 'write', tool_status: 'running' } as any)]
    const done = [toolMsg({ id: 't1', timestamp: 1000, tool_name: 'write', tool_status: 'success', tool_duration_ms: 200 } as any)]
    const r = mount(<WorkGroup items={running} />)
    try {
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(1)
      // 全部完成 → 自动折叠
      r.rerender(<WorkGroup items={done} />)
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(0)
      // 用户手动展开后，再次 rerender（仍完成）不被折叠
      const btn = r.host.querySelector('.work-group-toggle') as HTMLButtonElement
      act(() => { btn.click() })
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(1)
      r.rerender(<WorkGroup items={done} />)
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(1)
    } finally {
      r.unmount()
    }
  })

  it('点击组头在展开态下折叠（用户手动切换优先）', () => {
    const items = [toolMsg({ id: 't1', timestamp: 1000, tool_name: 'read', tool_status: 'running' } as any)]
    const r = mount(<WorkGroup items={items} />)
    try {
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(1)
      const btn = r.host.querySelector('.work-group-toggle') as HTMLButtonElement
      act(() => { btn.click() })
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(0)
      // 用户手动折叠后，rerender 仍折叠（running 也不自动展开）
      r.rerender(<WorkGroup items={items} />)
      expect(r.host.querySelectorAll('.tool-invoke').length).toBe(0)
    } finally {
      r.unmount()
    }
  })
})
