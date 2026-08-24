import { useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { submitRunInput } from '@/api/runs'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'

/**
 * ask_user dialog: surfaces a model question and submits the user's answer
 * through POST /runs/:id/inputs, which resumes the run with a fresh Run.
 */
export default function AskUserDialog() {
  const { pendingAskUser, clearAskUser } = useChatStore()
  const t = useI18n()
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!pendingAskUser) return null

  const handleSubmit = async () => {
    if (!answer.trim()) return
    const text = answer.trim()
    setBusy(true)
    setError('')
    // The authoritative answer bubble arrives via the `message.created` event,
    // which the server publishes before the 202 returns and the store renders
    // as a single `user` message (content = the full "问题：答案" instruction).
    // Inserting an optimistic bubble here would duplicate it — the event's
    // content is the whole instruction, not the raw answer — so we rely on that
    // event instead of double-rendering.
    try {
      await submitRunInput(pendingAskUser.run_id, text)
      setAnswer('')
      clearAskUser()
    } catch (err: any) {
      setError(err.message || t('提交失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="approval-overlay">
      <div className="approval-dialog" style={{ maxWidth: 480, width: '100%' }}>
        <div className="approval-title"><span style={{display:'inline-flex',marginRight:6,verticalAlign:'-2px'}}><Icon name="question" size={16} ariaHidden /></span>{t('需要您确认')}</div>
        <div className="approval-path" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
          {pendingAskUser.question}
        </div>
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          rows={3}
          placeholder={t('输入您的回答...')}
          autoFocus
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', background: 'var(--bg-input)', color: 'var(--ink-deep)', resize: 'vertical', fontFamily: 'inherit' }}
        />
        {error && <p style={{ color: 'var(--cinnabar)', fontSize: 'calc(12px * var(--ui-font-scale))', margin: '8px 0' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={clearAskUser}>{t('暂不回答')}</button>
          <button className="btn primary" disabled={busy || !answer.trim()} onClick={() => void handleSubmit()}>
            {busy ? t('提交中...') : t('回答')}
          </button>
        </div>
      </div>
    </div>
  )
}
