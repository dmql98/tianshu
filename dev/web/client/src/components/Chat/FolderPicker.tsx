import { useState, useEffect, Fragment } from 'react'
import { browseDirectory, resolvePath, type DirEntry } from '@/api/workspace'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'

interface Props {
  onSelect: (path: string) => void
  onClose: () => void
}

/** 把绝对路径拆成可点击的面包屑分段（支持 Windows 盘符 / Unix / 网络路径）。 */
function splitPath(path: string): { name: string; path: string }[] {
  if (!path) return []
  if (path.startsWith('\\\\')) return [{ name: path, path }]
  const isWin = /^[A-Za-z]:[\\/]/.test(path)
  if (isWin) {
    const m = path.match(/^([A-Za-z]:)\\?(.*)$/)
    if (m) {
      const segs: { name: string; path: string }[] = [{ name: m[1] + '\\', path: m[1] + '\\' }]
      const rest = m[2]
      if (rest) {
        const parts = rest.split(/[\\/]/).filter(Boolean)
        let acc = m[1] + '\\'
        for (const p of parts) {
          acc += p + '\\'
          segs.push({ name: p, path: acc })
        }
      }
      return segs
    }
  }
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) return [{ name: '/', path: '/' }]
  let acc = ''
  const segs: { name: string; path: string }[] = []
  for (const p of parts) {
    acc += '/' + p
    segs.push({ name: p, path: acc })
  }
  return segs
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

  const crumbs = splitPath(currentPath)

  return (
    <div className="approval-overlay" onClick={onClose}>
      <div className="folder-picker" onClick={e => e.stopPropagation()}>
        <div className="fpk-header">
          <span className="fpk-title">{t('选择项目目录')}</span>
          <button className="fpk-close" onClick={onClose} title={t('关闭')} aria-label={t('关闭')}>×</button>
        </div>

        <div className="fpk-crumbs">
          <button
            className="fpk-up"
            onClick={() => load(parentPath || undefined)}
            disabled={!parentPath}
            title={t('上级')}
          >↑</button>
          {crumbs.length === 0 ? (
            <span className="fpk-crumb" style={{ cursor: 'default' }}>{t('快捷入口')}</span>
          ) : crumbs.map((c, i) => (
            <Fragment key={c.path + i}>
              {i > 0 && <span className="fpk-sep">›</span>}
              <button className="fpk-crumb" title={c.path} onClick={() => load(c.path)}>{c.name}</button>
            </Fragment>
          ))}
        </div>

        <div className="fpk-address">
          <input
            value={manualPath}
            onChange={e => setManualPath(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goToPath() }}
            placeholder={t('直接输入路径后按回车，如 C:\\Users\\...')}
          />
          <button className="fpk-go" onClick={goToPath} disabled={!manualPath.trim()}>{t('前往')}</button>
        </div>
        {manualError && <div className="fpk-addr-err">{manualError}</div>}

        <div className="fpk-list">
          {loading ? (
            <div className="fpk-loading">{t('加载中...')}</div>
          ) : error ? (
            <div className="fpk-error">{error}</div>
          ) : entries.length === 0 ? (
            <div className="fpk-empty">{t('空目录')}</div>
          ) : entries.map(entry => (
            <div key={entry.path} className="fpk-row" title={entry.path} onClick={() => load(entry.path)}>
              <span className="fpk-ico"><Icon name="folder" size={16} ariaHidden /></span>
              <span className="fpk-name">{entry.name}</span>
            </div>
          ))}
        </div>

        <div className="fpk-footer">
          <button className="fpk-btn" onClick={onClose}>{t('取消')}</button>
          <button className="fpk-confirm" onClick={selectCurrentDir} disabled={!currentPath}>{t('选择此目录')}</button>
        </div>
      </div>
    </div>
  )
}
