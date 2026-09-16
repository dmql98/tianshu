import { useI18n } from '@/i18n'

/** 云同步轻量按钮组（共享样式）。busy 时禁用并转圈文案。 */
export function CloudButton({ label, busy, onClick, disabled }: { label: string; busy?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      className="settings-btn"
      onClick={onClick}
      disabled={disabled || busy}
      style={{ whiteSpace: 'nowrap' }}
    >
      {busy ? '…' : label}
    </button>
  )
}

/** 操作结果/错误提示行。 */
export function CloudMessage({ message, error }: { message?: string | null; error?: boolean }) {
  const t = useI18n()
  if (!message) return null
  const isError = error ?? true
  return (
    <div style={{
      marginTop: 6,
      padding: '6px 10px',
      borderRadius: 8,
      background: isError ? 'rgba(180,70,60,.1)' : 'rgba(74,144,84,.1)',
      color: isError ? 'var(--danger,#b4463c)' : 'var(--accent,#4a9054)',
      fontSize: 'calc(12px * var(--ui-font-scale))',
      whiteSpace: 'pre-wrap',
    }}>
      {message || t(' ')}
    </div>
  )
}
