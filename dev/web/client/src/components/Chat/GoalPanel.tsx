import { useState, useEffect } from 'react'
import { fetchGoals, pauseGoal, resumeGoal, fetchActivePlan, type Goal, type Plan } from '@/api/goals'
import { getEventBus } from '@/api/eventBus'
import PlanDialog from './PlanDialog'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'

const goalStatusKeys: Record<string, string> = {
  active: '进行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
}

export default function GoalPanel({ sessionId }: { sessionId: string }) {
  const t = useI18n()
  const [goals, setGoals] = useState<Goal[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPlan, setShowPlan] = useState(false)

  const reload = async () => {
    try {
      const [gs, p] = await Promise.all([fetchGoals(sessionId), fetchActivePlan(sessionId)])
      setGoals(gs)
      setPlan(p)
    } catch { /* server may be down */ }
  }

  useEffect(() => {
    setShowPlan(false)
    void reload()
  }, [sessionId])

  useEffect(() => {
    const bus = getEventBus()
    const onChange = (event: { session_id?: string }) => {
      if (event.session_id === sessionId) void reload()
    }
    const offConnect = bus.onConnect(() => { void reload() })
    bus.on('plan.created', onChange)
    bus.on('plan.step.updated', onChange)
    bus.on('goal.created', onChange)
    bus.on('goal.status.changed', onChange)
    bus.on('goal.paused', onChange)
    return () => {
      bus.off('plan.created', onChange)
      bus.off('plan.step.updated', onChange)
      bus.off('goal.created', onChange)
      bus.off('goal.status.changed', onChange)
      bus.off('goal.paused', onChange)
      offConnect()
    }
  }, [sessionId])

  const activeGoal = goals.find(g => g.status === 'active' || g.status === 'paused')
  const completedGoals = goals.filter(g => g.status === 'completed')

  const handlePause = async () => {
    if (!activeGoal) return
    await pauseGoal(activeGoal.id)
    await reload()
  }

  const handleResume = async () => {
    if (!activeGoal) return
    setBusy(true)
    try {
      await resumeGoal(activeGoal.id)
      await reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('续跑失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rp-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="rp-section-title">
        {t('目标与计划')}
      </div>

      {activeGoal ? (
        <div style={{ fontSize: 'calc(12px * var(--ui-font-scale))', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="goal" size={14} ariaHidden />{activeGoal.outcome}</span>
            <span style={{ color: activeGoal.status === 'active' ? 'var(--jade)' : 'var(--gold)' }}>{t(goalStatusKeys[activeGoal.status])}</span>
          </div>
          {activeGoal.verification && (
            <div style={{ color: 'var(--ink-light)' }}>{t('验证')}：{activeGoal.verification}</div>
          )}
          {activeGoal.budget_tokens && (
            <div style={{ color: 'var(--ink-light)' }}>
              {t('预算')}：{activeGoal.used_input_tokens + activeGoal.used_output_tokens} / {activeGoal.budget_tokens} tokens
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {activeGoal.status === 'active' ? (
              <button className="btn sm" onClick={() => void handlePause()}>{t('暂停')}</button>
            ) : (
              <button className="btn sm primary" disabled={busy} onClick={() => void handleResume()}>{t('继续（新 Run）')}</button>
            )}
          </div>
        </div>
      ) : completedGoals.length > 0 ? (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>
          {t('已完成目标')}：{completedGoals.map(g => g.outcome).join('；')}
        </div>
      ) : (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('暂无目标，Agent 可在执行中创建 goal 与 plan')}</div>
      )}

      {plan && plan.steps.length > 0 ? (
        <div className="plan-summary-card">
          <div className="plan-summary-info">
            <span>计划 v{plan.version}</span>
            <strong>{plan.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length}/{plan.steps.length} {t('步')}</strong>
          </div>
          <button className="btn sm" type="button" onClick={() => setShowPlan(true)}>{t('查看完整计划')}</button>
        </div>
      ) : (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)', marginTop: 2 }}>{t('当前暂无计划')}</div>
      )}

      {showPlan && plan && <PlanDialog plan={plan} onClose={() => setShowPlan(false)} />}
    </div>
  )
}
