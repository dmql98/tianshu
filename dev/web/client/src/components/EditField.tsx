import { useState, useEffect, type ReactNode, type CSSProperties } from 'react'

interface EditFieldProps {
  label?: string
  value: string
  onSave: (value: string) => void
  renderInput: (value: string, onChange: (v: string) => void) => ReactNode
  display?: ReactNode
  className?: string
  style?: CSSProperties
}

export default function EditField({
  label, value, onSave, renderInput, display, className, style,
}: EditFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const startEdit = () => { setDraft(value); setEditing(true) }
  const cancel = () => { setEditing(false) }
  const save = () => { onSave(draft); setEditing(false) }

  return (
    <div className={className} style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
        {label && <div className="info-item-label" style={{ marginBottom: 0, flex: 1 }}>{label}</div>}
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="detail-btn" style={{ padding: '3px 10px', fontSize: 12 }} onClick={cancel}>取消</button>
            <button type="button" className="detail-btn primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={save}>保存</button>
          </div>
        ) : (
          <button type="button" className="detail-btn" style={{ padding: '3px 10px', fontSize: 12 }} onClick={startEdit}>编辑</button>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        {editing ? renderInput(draft, setDraft) : (display ?? (
          <div style={{
            padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg-input)', color: value ? 'var(--ink-deep)' : 'var(--ink-faint)',
            fontSize: 13, minHeight: 22, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {value || '（未设置）'}
          </div>
        ))}
      </div>
    </div>
  )
}
