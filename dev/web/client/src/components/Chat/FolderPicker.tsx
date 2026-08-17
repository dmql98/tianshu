import { useState, useEffect } from 'react'
import { browseDirectory, resolvePath, type DirEntry } from '@/api/workspace'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'

interface Props {
  onSelect: (path: string) => void
  onClose: () => void
}

export default function FolderPicker({ onSelect, onClose }: Props) {
  const t = useI18n()
  const [currentPath, setCurrentPath] = useState('')
  const [parentPath, setParentPath] = useState<string | null>(null)
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [manualError, setManualError] = useState('')

  async function load(path?: string) {
    setLoading(true)
    setError('')
    try {
      const result = await browseDirectory(path)
      setCurrentPath(result.currentPath)
      setParentPath(result.parentPath)
      setEntries(result.entries.filter(e => e.isDir))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function goToPath() {
    const p = manualPath.trim()
    if (!p) return
    setManualError('')
    if (p.includes('..')) { setManualError(t('路径不能包含 ..')); return }
    try {
      const result = await resolvePath(p)
      if (result.path) load(result.path)
      else setManualError(t('路径不存在'))
    } catch {
      setManualError(t('路径解析失败'))
    }
  }

  function selectCurrentDir() {
    if (currentPath) onSelect(currentPath)
  }

  return (
    <div className="approval-overlay" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: 12, width: 560, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
          <span style={{ fontSize: 'calc(15px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-deep)' }}>{t('选择项目目录')}</span>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Manual input */}
        <div style={{ display: 'flex', gap: 6, padding: '6px 20px 4px' }}>
          <input
            value={manualPath}
            onChange={e => setManualPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goToPath() }}
            placeholder={t('直接输入路径后按回车，如 C:\\Users\\...')}
            style={{
              flex: 1, padding: '6px 10px', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: 'calc(13px * var(--ui-font-scale))', outline: 'none',
              background: 'var(--bg-input)', color: 'var(--ink-deep)',
            }}
          />
          <button
            onClick={goToPath}
            disabled={!manualPath.trim()}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: 6,
              background: 'var(--gold)', color: '#fff', fontSize: 'calc(13px * var(--ui-font-scale))',
              cursor: 'pointer', whiteSpace: 'nowrap', opacity: manualPath.trim() ? 1 : 0.5,
            }}
          >{t('前往')}</button>
        </div>
        {manualError && <div style={{ padding: '0 20px 4px', fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--cinnabar)' }}>{manualError}</div>}

        {/* Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => load(parentPath || undefined)}
            disabled={!currentPath}
            style={{
              background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 4,
              padding: '3px 8px', fontSize: 'calc(12px * var(--ui-font-scale))', cursor: currentPath ? 'pointer' : 'default',
              opacity: currentPath ? 1 : 0.4, whiteSpace: 'nowrap', color: 'var(--ink-mid)',
            }}
          >.. {t('上级')}</button>
          <span style={{ fontSize: 'calc(12px * var(--ui-font-scale))', color: 'var(--ink-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {currentPath || t('快捷入口')}
          </span>
          <button
            onClick={selectCurrentDir}
            disabled={!currentPath}
            style={{
              background: 'rgba(200,150,10,0.08)', border: '1px solid rgba(200,150,10,0.2)',
              borderRadius: 4, padding: '3px 8px', fontSize: 'calc(12px * var(--ui-font-scale))', cursor: currentPath ? 'pointer' : 'default',
              color: 'var(--gold)', whiteSpace: 'nowrap', opacity: currentPath ? 1 : 0.4,
            }}
          >{t('选择当前目录')}</button>
        </div>

        {/* Directory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 'calc(13px * var(--ui-font-scale))' }}>{t('加载中...')}</div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--cinnabar)', fontSize: 'calc(13px * var(--ui-font-scale))' }}>{error}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 'calc(13px * var(--ui-font-scale))' }}>{t('空目录')}</div>
          ) : entries.map(entry => (
            <div
              key={entry.path}
              onClick={() => load(entry.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 20px', cursor: 'pointer', fontSize: 'calc(13px * var(--ui-font-scale))',
                color: 'var(--ink-deep)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ flexShrink: 0, display: 'inline-flex' }}><Icon name="folder" size={15} ariaHidden /></span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{entry.name}</span>
              <span style={{ fontSize: 'calc(11px * var(--ui-font-scale))', color: 'var(--ink-faint)', flexShrink: 0 }}>▸</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--ink-mid)', cursor: 'pointer', fontSize: 'calc(13px * var(--ui-font-scale))' }}
          >{t('取消')}</button>
          <button
            onClick={selectCurrentDir}
            disabled={!currentPath}
            style={{
              padding: '7px 16px', border: 'none', borderRadius: 6,
              background: 'var(--gold)', color: '#fff', cursor: currentPath ? 'pointer' : 'default',
              fontSize: 'calc(13px * var(--ui-font-scale))', opacity: currentPath ? 1 : 0.5,
            }}
          >{t('选择此目录')}</button>
        </div>
      </div>
    </div>
  )
}
