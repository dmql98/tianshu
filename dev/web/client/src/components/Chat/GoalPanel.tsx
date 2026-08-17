import { useState, useEffect } from 'react'
import { fetchGoals, createGoal, pauseGoal, resumeGoal, fetchActivePlan, type Goal, type Plan } from '@/api/goals'
import { getSocket } from '@/api/socket'
import PlanDialog from './PlanDialog'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'

const goalStatusKeys: Record<string, string> = {
  active: '进行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
}

export default function GoalPanel({ sessionId, mode }: { sessionId: string; mode: string }) {
  const t = useI18n()
  const [goals, setGoals] = useState<Goal[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [outcome, setOutcome] = useState('')
  const [verification, setVerification] = useState('')
  const [budget, setBudget] = useState('')
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
    const socket = getSocket()
    if (!socket) return
    const onPlanChange = (event: { session_id?: string }) => {
      if (event.session_id === sessionId) void reload()
    }
    const onReconnect = () => { void reload() }
    socket.on('plan.created', onPlanChange)
    socket.on('plan.step.updated', onPlanChange)
    socket.on('connect', onReconnect)
    return () => {
      socket.off('plan.created', onPlanChange)
      socket.off('plan.step.updated', onPlanChange)
      socket.off('connect', onReconnect)
    }
  }, [sessionId])

  const activeGoal = mode === 'goal'
    ? goals.find(g => g.status === 'active' || g.status === 'paused')
    : undefined

  const handleCreate = async () => {
    if (!outcome.trim()) return
    setBusy(true)
    try {
      await createGoal({
        session_id: sessionId,
        outcome: outcome.trim(),
        verification: verification.trim() || undefined,
        budget_tokens: budget ? Number(budget) : undefined,
      })
      setOutcome('')
      setVerification('')
      setBudget('')
      await reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('创建目标失败'))
    } finally {
      setBusy(false)
    }
  }

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
        {mode === 'goal' && <span style={{ fontWeight: 400, fontSize: 'calc(10px * var(--ui-font-scale))' }}>（Goal · {t('持续执行')}）</span>}
        {mode === 'plan_first' && <span style={{ fontWeight: 400, fontSize: 'calc(10px * var(--ui-font-scale))' }}>（Plan-first · {t('强制计划')}）</span>}
        {mode === 'direct' && <span style={{ fontWeight: 400, fontSize: 'calc(10px * var(--ui-font-scale))' }}>（Direct · {t('计划可选')}）</span>}
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
      ) : mode === 'goal' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="text"
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            placeholder={t('目标（例如：调研并整理 TianShu 的发布清单）')}
            style={{ fontSize: 'calc(12px * var(--ui-font-scale))', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <input
            type="text"
            value={verification}
            onChange={e => setVerification(e.target.value)}
            placeholder={t('验证标准（可选）')}
            style={{ fontSize: 'calc(12px * var(--ui-font-scale))', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder={t('Token 预算（可选）')}
            style={{ fontSize: 'calc(12px * var(--ui-font-scale))', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <button className="btn sm primary" disabled={busy || !outcome.trim()} onClick={() => void handleCreate()}>{t('创建目标')}</button>
        </div>
      ) : mode === 'plan_first' ? (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('Agent 必须先创建计划，再按步骤执行。')}</div>
      ) : (
        <div style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)' }}>{t('Agent 可以直接执行，也可以按需要创建计划。')}</div>
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
