import { useState, useEffect } from 'react'
import { fetchGoals, createGoal, pauseGoal, resumeGoal, fetchActivePlan, type Goal, type Plan } from '@/api/goals'

const goalStatusLabels: Record<string, string> = {
  active: '进行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
}

export default function GoalPanel({ sessionId, mode }: { sessionId: string; mode: string }) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [outcome, setOutcome] = useState('')
  const [verification, setVerification] = useState('')
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    try {
      const [gs, p] = await Promise.all([fetchGoals(sessionId), fetchActivePlan(sessionId)])
      setGoals(gs)
      setPlan(p)
    } catch { /* server may be down */ }
  }

  useEffect(() => { void reload() }, [sessionId])

  const activeGoal = goals.find(g => g.status === 'active' || g.status === 'paused')

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
      alert(err instanceof Error ? err.message : '创建目标失败')
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
      alert(err instanceof Error ? err.message : '续跑失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rp-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="rp-section-title">目标与计划 {mode !== 'goal' && <span style={{ fontWeight: 400, fontSize: 10 }}>(当前执行模式不生效)</span>}</div>

      {activeGoal ? (
        <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>🎯 {activeGoal.outcome}</span>
            <span style={{ color: activeGoal.status === 'active' ? 'var(--jade)' : 'var(--gold)' }}>{goalStatusLabels[activeGoal.status]}</span>
          </div>
          {activeGoal.verification && (
            <div style={{ color: 'var(--ink-light)' }}>验证：{activeGoal.verification}</div>
          )}
          {activeGoal.budget_tokens && (
            <div style={{ color: 'var(--ink-light)' }}>
              预算：{activeGoal.used_input_tokens + activeGoal.used_output_tokens} / {activeGoal.budget_tokens} tokens
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {activeGoal.status === 'active' ? (
              <button className="btn sm" onClick={() => void handlePause()}>暂停</button>
            ) : (
              <button className="btn sm primary" disabled={busy} onClick={() => void handleResume()}>继续（新 Run）</button>
            )}
          </div>
        </div>
      ) : mode === 'goal' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input
            type="text"
            value={outcome}
            onChange={e => setOutcome(e.target.value)}
            placeholder="目标（例如：调研并整理 TianShu 的发布清单）"
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <input
            type="text"
            value={verification}
            onChange={e => setVerification(e.target.value)}
            placeholder="验证标准（可选）"
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <input
            type="number"
            value={budget}
            onChange={e => setBudget(e.target.value)}
            placeholder="Token 预算（可选）"
            style={{ fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--ink-deep)' }}
          />
          <button className="btn sm primary" disabled={busy || !outcome.trim()} onClick={() => void handleCreate()}>创建目标</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>切到 Goal 模式后可为会话创建目标</div>
      )}

      {plan && plan.steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-light)' }}>计划 v{plan.version}（{plan.steps.filter(s => s.status === 'completed').length}/{plan.steps.length} 步）</div>
          {plan.steps.map(step => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <span style={{ color: step.status === 'completed' ? 'var(--jade)' : step.status === 'failed' || step.status === 'blocked' ? 'var(--cinnabar)' : step.status === 'in_progress' ? 'var(--gold)' : 'var(--ink-faint)' }}>
                {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '▶' : step.status === 'failed' ? '✗' : step.status === 'blocked' ? '⛔' : '○'}
              </span>
              <span style={{ color: 'var(--ink-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {step.ordinal}. {step.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
