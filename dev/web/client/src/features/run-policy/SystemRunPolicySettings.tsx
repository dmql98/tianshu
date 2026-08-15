import { useI18n } from '@/i18n'
import { useState, useEffect } from 'react'
import { fetchRunPolicy, saveRunPolicy, resetRunPolicy } from '@/api/runPolicy'
import type { SystemRunPolicy } from './types'

interface Props {
  showToast: (msg: string, type?: 'ok' | 'err') => void
}

const num = (v: string, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export default function SystemRunPolicySettings({ showToast }: Props) {
  const t = useI18n()
  const [policy, setPolicy] = useState<SystemRunPolicy | null>(null)
  const [defaults, setDefaults] = useState<SystemRunPolicy | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchRunPolicy()
      .then(res => { setPolicy(res.policy); setDefaults(res.defaults) })
      .catch(() => showToast(t('加载运行策略失败'), 'err'))
  }, [])

  if (!policy || !defaults) {
    return <div style={{ padding: 20, color: 'var(--ink-faint)', fontSize: 'calc(12px * var(--ui-font-scale))' }}>{t('加载中...')}</div>
  }

  const setNum = (key: keyof SystemRunPolicy, value: string, min: number, max: number) => {
    const n = Math.min(max, Math.max(min, num(value, policy[key] as number)))
    setPolicy({ ...policy, [key]: n })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await saveRunPolicy(policy)
      setPolicy(res.policy)
      showToast(t('运行策略已保存（仅对新 Run 生效）'))
    } catch {
      showToast(t('保存失败'), 'err')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setSaving(true)
    try {
      const res = await resetRunPolicy()
      setPolicy(res.policy)
      showToast(t('已恢复系统默认值'))
    } catch {
      showToast(t('重置失败'), 'err')
    } finally {
      setSaving(false)
    }
  }

  const boolRow = (label: string, hint: string, key: 'dynamicLimitEnabled' | 'autoContinuationEnabled', warning?: string) => (
    <div className="setting-row">
      <div className="setting-info">
        <span className="setting-label">{label}</span>
        <span className="setting-hint">{hint}</span>
        {warning && policy[key] && <span className="setting-hint" style={{ color: 'var(--cinnabar)' }}>{warning}</span>}
      </div>
      <div className="setting-control">
        <div className={`toggle ${policy[key] ? 'on' : ''}`} onClick={() => setPolicy({ ...policy, [key]: !policy[key] })} />
      </div>
    </div>
  )

  const numRow = (label: string, hint: string, key: keyof SystemRunPolicy, min: number, max: number, isCap = false) => (
    <div className="setting-row">
      <div className="setting-info">
        <span className="setting-label">{label}</span>
        <span className="setting-hint">{hint}{isCap ? t('（不可突破上限）') : ''}</span>
      </div>
      <div className="setting-control">
        <input
          type="number"
          min={min}
          max={max}
          value={policy[key] as number}
          onChange={e => setNum(key, e.target.value, min, max)}
          style={{ width: 90, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
        />
      </div>
    </div>
  )

  return (
    <div className="settings-section" style={{ marginTop: 32 }}>
      <div className="section-title">{t('运行与安全')}</div>
      <div className="section-desc">{t('系统级运行安全边界，角色只能请求更保守的值。修改仅对新创建的 Run 生效。')}</div>

      <div className="setting-group">
        <div className="setting-group-title">{t('动态限额')}</div>
        {boolRow(t('动态限额'), t('启用软上限、宽限与无进展停止'), 'dynamicLimitEnabled')}
        {numRow(t('默认软轮次'), t('角色未指定时，多少轮后开始收敛'), 'defaultSoftTurns', 1, policy.maxAbsoluteTurnsPerRun)}
        {numRow(t('默认宽限轮次'), t('软上限后的默认宽限'), 'defaultGraceTurns', 0, policy.maxGraceTurns)}
        {numRow(t('单 Run 绝对上限'), t('单次运行的模型轮次硬上限'), 'maxAbsoluteTurnsPerRun', 1, 999, true)}
        {numRow(t('最大角色宽限'), t('角色最多可申请多少宽限轮次'), 'maxGraceTurns', 0, policy.maxAbsoluteTurnsPerRun - 1, true)}
      </div>

      <div className="setting-group">
        <div className="setting-group-title">{t('自动续跑')}</div>
        {boolRow(t('自动续跑'), t('Plan-first / Goal 模式到达上限后自动继续'), 'autoContinuationEnabled', t('开启后会自动消耗 token 并占用较长时间，请确认限额'))}
        {numRow(t('最多自动续跑次数'), t('单链最大自动续跑次数'), 'maxAutoContinuations', 0, 50, true)}
        {numRow(t('链累计轮次上限'), t('整条链累计模型轮次上限'), 'maxChainTurns', 1, 1000000, true)}
        {numRow(t('链累计 Token 上限'), t('整条链累计 token 上限'), 'maxChainTokens', 1, 100000000, true)}
        {numRow(t('链最长墙钟时间（秒）'), t('整条链最长运行时间'), 'maxChainWallTimeMs', 1, 86400000, true)}
      </div>

      <div className="setting-group">
        <div className="setting-group-title">{t('进展检测（高级）')}</div>
        {numRow(t('连续无进展阈值'), t('达到阈值后按无进展停止'), 'noProgressThreshold', 1, 100)}
        {numRow(t('连续弱进展阈值'), t('只有弱进展时按无进展处理'), 'weakProgressThreshold', 1, 100)}
        {numRow(t('重复工具循环阈值'), t('相同工具指纹重复次数'), 'repeatedToolLoopThreshold', 1, 100)}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn primary" onClick={handleSave} disabled={saving}>{saving ? t('保存中…') : t('保存运行策略')}</button>
        <button className="btn" onClick={handleReset} disabled={saving}>{t('恢复系统默认')}</button>
      </div>
    </div>
  )
}
