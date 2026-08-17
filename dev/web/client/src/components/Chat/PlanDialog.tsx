import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { Plan, PlanStep } from '@/api/goals'
import { useI18n } from '@/i18n'

const statusMeta: Record<PlanStep['status'], { icon: string; label: string; tone: string }> = {
  pending: { icon: '○', label: '等待', tone: 'muted' },
  in_progress: { icon: '▶', label: '进行中', tone: 'running' },
  blocked: { icon: '⊗', label: '阻塞', tone: 'danger' },
  completed: { icon: '✓', label: '已完成', tone: 'success' },
  skipped: { icon: '↷', label: '已跳过', tone: 'muted' },
  failed: { icon: '✗', label: '失败', tone: 'danger' },
}

export default function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const t = useI18n()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const completed = plan.steps.filter(step => step.status === 'completed' || step.status === 'skipped').length
  const progress = plan.steps.length > 0 ? Math.round((completed / plan.steps.length) * 100) : 0

  return createPortal(
    <div className="plan-dialog-overlay" onMouseDown={onClose}>
      <section
        className="plan-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-dialog-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="plan-dialog-header">
          <div>
            <h2 id="plan-dialog-title">{t('执行计划')} v{plan.version}</h2>
            <div className="plan-dialog-summary">{completed}/{plan.steps.length} {t('步完成')} · {progress}%</div>
          </div>
          <button className="plan-dialog-close" type="button" aria-label={t('关闭计划')} onClick={onClose}>×</button>
        </header>

        <div className="plan-dialog-progress" aria-label={t('计划进度 {pct}%', { pct: progress })}>
          <div style={{ width: `${progress}%` }} />
        </div>

        <div className="plan-dialog-list">
          {plan.steps.map(step => {
            const meta = statusMeta[step.status]
            return (
              <article key={step.id} className={`plan-dialog-step ${meta.tone}`}>
                <div className="plan-dialog-step-marker">{meta.icon}</div>
                <div className="plan-dialog-step-content">
                  <div className="plan-dialog-step-heading">
                    <span className="plan-dialog-step-title">{step.ordinal}. {step.title}</span>
                    <span className={`plan-dialog-step-status ${meta.tone}`}>{t(meta.label)}</span>
                  </div>
                  {step.depends_on && <div className="plan-dialog-step-detail"><span>{t('依赖')}</span>{step.depends_on}</div>}
                  {step.verification && <div className="plan-dialog-step-detail"><span>{t('验证')}</span>{step.verification}</div>}
                  {step.evidence && <div className="plan-dialog-step-detail evidence"><span>{t('证据')}</span>{step.evidence}</div>}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>,
    document.body,
  )
}
