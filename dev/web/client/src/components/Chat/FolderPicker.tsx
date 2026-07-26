import { useState, useEffect } from 'react'
import { browseDirectory, resolvePath, type DirEntry } from '@/api/workspace'

interface Props {
  onSelect: (path: string) => void
  onClose: () => void
}

export default function FolderPicker({ onSelect, onClose }: Props) {
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
    if (p.includes('..')) { setManualError('路径不能包含 ..'); return }
    try {
      const result = await resolvePath(p)
      if (result.path) load(result.path)
      else setManualError('路径不存在')
    } catch {
      setManualError('路径解析失败')
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
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-deep)' }}>选择项目目录</span>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--ink-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Manual input */}
        <div style={{ display: 'flex', gap: 6, padding: '6px 20px 4px' }}>
          <input
            value={manualPath}
            onChange={e => setManualPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goToPath() }}
            placeholder="直接输入路径后按回车，如 C:\Users\..."
            style={{
              flex: 1, padding: '6px 10px', border: '1px solid var(--border)',
              borderRadius: 6, fontSize: 13, outline: 'none',
              background: 'var(--bg-input)', color: 'var(--ink-deep)',
            }}
          />
          <button
            onClick={goToPath}
            disabled={!manualPath.trim()}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: 6,
              background: 'var(--gold)', color: '#fff', fontSize: 13,
              cursor: 'pointer', whiteSpace: 'nowrap', opacity: manualPath.trim() ? 1 : 0.5,
            }}
          >前往</button>
        </div>
        {manualError && <div style={{ padding: '0 20px 4px', fontSize: 12, color: 'var(--cinnabar)' }}>{manualError}</div>}

        {/* Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => load(parentPath || undefined)}
            disabled={!currentPath}
            style={{
              background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 4,
              padding: '3px 8px', fontSize: 12, cursor: currentPath ? 'pointer' : 'default',
              opacity: currentPath ? 1 : 0.4, whiteSpace: 'nowrap', color: 'var(--ink-mid)',
            }}
          >.. 上级</button>
          <span style={{ fontSize: 12, color: 'var(--ink-light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {currentPath || '快捷入口'}
          </span>
          <button
            onClick={selectCurrentDir}
            disabled={!currentPath}
            style={{
              background: 'rgba(200,150,10,0.08)', border: '1px solid rgba(200,150,10,0.2)',
              borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: currentPath ? 'pointer' : 'default',
              color: 'var(--gold)', whiteSpace: 'nowrap', opacity: currentPath ? 1 : 0.4,
            }}
          >选择当前目录</button>
        </div>

        {/* Directory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>加载中...</div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--cinnabar)', fontSize: 13 }}>{error}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>空目录</div>
          ) : entries.map(entry => (
            <div
              key={entry.path}
              onClick={() => load(entry.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 20px', cursor: 'pointer', fontSize: 13,
                color: 'var(--ink-deep)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>📁</span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{entry.name}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-faint)', flexShrink: 0 }}>▸</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            style={{ padding: '7px 16px', border: 'none', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--ink-mid)', cursor: 'pointer', fontSize: 13 }}
          >取消</button>
          <button
            onClick={selectCurrentDir}
            disabled={!currentPath}
            style={{
              padding: '7px 16px', border: 'none', borderRadius: 6,
              background: 'var(--gold)', color: '#fff', cursor: currentPath ? 'pointer' : 'default',
              fontSize: 13, opacity: currentPath ? 1 : 0.5,
            }}
          >选择此目录</button>
        </div>
      </div>
    </div>
  )
}
