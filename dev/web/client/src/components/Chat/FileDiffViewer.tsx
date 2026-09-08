import { useMemo } from 'react'
import { useI18n } from '@/i18n'
import type { FileChange } from '@/types'

interface FileDiffViewerProps {
  file: FileChange
  /** undefined=加载中；null=不可用（git 缺失/请求失败）；''=无 patch（文件已删除）。 */
  patch: string | null | undefined
  onClose: () => void
}

/** P3 diff 查看器：行内渲染 git unified patch（手写按行首着色，零依赖）。 */
export default function FileDiffViewer({ file, patch, onClose }: FileDiffViewerProps) {
  const t = useI18n()

  const lines = useMemo(() => {
    if (!patch) return []
    return patch.split('\n')
  }, [patch])

  return (
    <div className="fd-viewer">
      <div className="fd-toolbar">
        <span className="fd-path" title={file.path}>{file.path}</span>
        {file.additions > 0 && <span className="fd-stat fd-stat-add">+{file.additions}</span>}
        {file.deletions > 0 && <span className="fd-stat fd-stat-del">−{file.deletions}</span>}
        <button className="fd-close" onClick={onClose} title={t('关闭')}>✕</button>
      </div>
      {patch === undefined ? (
        <div className="fd-empty">{t('加载中')}…</div>
      ) : patch === null ? (
        <div className="fd-empty">{t('diff 不可用')}</div>
      ) : lines.length === 0 ? (
        <div className="fd-empty">{t('文件已删除')}</div>
      ) : (
        <pre className="fd-pre">
          {lines.map((line, i) => {
            const cls = line.startsWith('+') && !line.startsWith('+++')
              ? 'fd-line fd-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'fd-line fd-del'
                : line.startsWith('@@')
                  ? 'fd-line fd-hunk'
                  : 'fd-line fd-ctx'
            return (
              <div key={i} className={cls}>
                <span className="fd-ln">{i + 1}</span>
                {line || ' '}
              </div>
            )
          })}
        </pre>
      )}
    </div>
  )
}
