import { useEffect, useMemo, useState } from 'react'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import Icon from '@/features/icons/Icon'
import { useI18n } from '@/i18n'
import type { FileChange } from '@/types'
import FileDiffViewer from './FileDiffViewer'

interface FileEntry {
  name: string
  path?: string
  source: 'attachment' | 'tool-read' | 'tool-write' | 'tool-output'
  icon: string
}

/** 附件分组与「打开所在目录」沿用旧 FilePanel 逻辑。 */
function extractPath(toolInput?: string): string | undefined {
  if (!toolInput) return undefined
  try {
    const parsed = JSON.parse(toolInput)
    return parsed.file_path || parsed.path || parsed.filePath || undefined
  } catch {
    return undefined
  }
}

function dirOf(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  parts.pop()
  return parts.join(sep) || sep
}

async function openDirectory(path: string) {
  try {
    await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
  } catch {
    navigator.clipboard.writeText(path).catch(() => {})
  }
}

interface TreeNode {
  name: string
  fullPath: string
  file?: FileChange
  children: Map<string, TreeNode>
}

/** 把聚合文件列表构造成目录树（/、\\ 切分，目录节点聚合子文件）。 */
function buildTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: new Map() }
  const sep = (p: string) => (p.includes('\\') ? '\\' : '/')
  for (const f of files) {
    const parts = f.path.split(sep(f.path))
    let node = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      acc = acc ? `${acc}${sep(f.path)}${part}` : part
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, fullPath: acc, children: new Map() }
        node.children.set(part, child)
      }
      node = child
    }
    node.file = f
  }
  return root
}

function sortTree(root: TreeNode) {
  const dirs = [...root.children.values()].filter(c => !c.file)
  const files = [...root.children.values()].filter(c => c.file)
  dirs.sort((a, b) => a.name.localeCompare(b.name))
  files.sort((a, b) => a.name.localeCompare(b.name))
  const sorted = [...dirs, ...files]
  for (const d of dirs) sortTree(d)
  return sorted
}

export default function FilePanel() {
  const { sessions, activeSessionId, fileChanges, fileScope, fetchFileChanges, setFileScope, fetchFileDiff } = useChatStore()
  const { toggleFilePanel } = useUIStore()
  const t = useI18n()
  const session = sessions.find(s => s.id === activeSessionId)
  const messages = session?.messages || []

  const key = activeSessionId ?? ''
  const changes = useMemo(() => (fileChanges[key] ?? []).filter(f => f.status !== 'noop' as unknown as FileChange['status']), [fileChanges, key])
  const totalAdd = changes.reduce((s, f) => s + f.additions, 0)
  const totalDel = changes.reduce((s, f) => s + f.deletions, 0)
  const tree = useMemo(() => buildTree(changes), [changes])
  const sortedChildren = useMemo(() => sortTree(tree), [tree])

  // 打开面板 / 切视图时拉取一次，之后靠 tool.completed 实时增量 + 手动刷新。
  useEffect(() => {
    if (!activeSessionId) return
    fetchFileChanges(activeSessionId, fileScope)
  }, [activeSessionId, fileScope, fetchFileChanges])

  // 切会话清 diff 展开态（P3 验收：切会话清展开态）。
  useEffect(() => {
    setOpenFile(null)
    setPatchCache({})
  }, [activeSessionId])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [patchCache, setPatchCache] = useState<Record<string, string | null>>({})

  const toggleDir = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleFile = async (f: FileChange) => {
    if (openFile === f.path) {
      setOpenFile(null)
      return
    }
    setOpenFile(f.path)
    if (patchCache[f.path] !== undefined) return
    const patch = await fetchFileDiff(activeSessionId ?? '', f.path)
    setPatchCache(prev => ({ ...prev, [f.path]: patch }))
  }

  // 旧 FilePanel 附件/工具文件分组（保留原有行为）
  const files = useMemo(() => {
    const entries: FileEntry[] = []
    const seen = new Set<string>()
    for (const m of messages) {
      if (m.attachments) {
        for (const att of m.attachments) {
          const akey = `att:${att.name}`
          if (!seen.has(akey)) {
            seen.add(akey)
            entries.push({ name: att.name, source: 'attachment', icon: att.mime?.startsWith('image/') ? 'image' : 'attach' })
          }
        }
      }
      if (m.role === 'tool') {
        const toolName = m.tool_name || ''
        const filePath = extractPath(m.tool_input)
        if ((toolName === 'read' || toolName === 'glob') && filePath) {
          const rkey = `read:${filePath}`
          if (!seen.has(rkey)) {
            seen.add(rkey)
            entries.push({ name: filePath.split(/[/\\]/).pop() || filePath, path: filePath, source: 'tool-read', icon: 'tool-read' })
          }
        }
        if ((toolName === 'write' || toolName === 'edit') && filePath) {
          const wkey = `write:${filePath}`
          if (!seen.has(wkey)) {
            seen.add(wkey)
            entries.push({ name: filePath.split(/[/\\]/).pop() || filePath, path: filePath, source: 'tool-write', icon: 'tool-write' })
          }
        }
      }
    }
    return entries
  }, [messages])

  const attachments = files.filter(f => f.source === 'attachment')
  const toolFiles = files.filter(f => f.source === 'tool-read' || f.source === 'tool-write')

  const renderNode = (node: TreeNode, depth: number) => {
    const isDir = !node.file
    const isExpanded = expanded.has(node.fullPath)
    const children = isDir ? sortTree(node) : []
    return (
      <div key={node.fullPath || '/'}>
        {isDir ? (
          <>
            <div
              className="fp-tree-row"
              style={{ paddingLeft: depth * 14 + 4 }}
              onClick={() => toggleDir(node.fullPath)}
              title={node.fullPath}
            >
              <span className={`fp-chevron${isExpanded ? ' open' : ''}`}>▸</span>
              <Icon name="folder" size={13} ariaHidden />
              <span className="fp-tree-name">{node.name}</span>
            </div>
            {isExpanded && children.map(c => renderNode(c, depth + 1))}
          </>
        ) : (
          <div
            className={`fp-tree-row${openFile === node.file!.path ? ' active' : ''}`}
            style={{ paddingLeft: depth * 14 + 4 }}
            onClick={() => toggleFile(node.file!)}
            title={node.file!.path}
          >
            <span className="fp-spacer" />
            <span className={`fp-status fp-status-${node.file!.status[0]}`}>{node.file!.status[0]}</span>
            <span className="fp-tree-name">{node.name}</span>
            <span className="fp-diff-stat">
              {node.file!.additions > 0 && <span className="fp-diff-add">+{node.file!.additions}</span>}
              {node.file!.deletions > 0 && <span className="fp-diff-del">−{node.file!.deletions}</span>}
            </span>
          </div>
        )}
      </div>
    )
  }

  const openChange = changes.find(f => f.path === openFile)

  return (
    <aside className="file-panel">
      <div className="fp-header">
        <span className="fp-title">{t('文件改动')}</span>
        <span className="fp-close" onClick={toggleFilePanel}>✕</span>
      </div>
      <div className="fp-body">
        {/* 汇总 + 视图开关 */}
        <div className="fp-summary">
          <span className="fp-summary-stats">
            {totalAdd > 0 && <span className="fp-diff-add">+{totalAdd}</span>}
            {totalDel > 0 && <span className="fp-diff-del">−{totalDel}</span>}
            {changes.length > 0 && <span className="fp-summary-count">· {changes.length}</span>}
          </span>
          <div className="fp-scope-tabs">
            <button
              className={`fp-scope-tab${fileScope === 'session' ? ' active' : ''}`}
              onClick={() => setFileScope('session')}
            >{t('本会话')}</button>
            <button
              className={`fp-scope-tab${fileScope === 'project' ? ' active' : ''}`}
              onClick={() => setFileScope('project')}
            >{t('全项目')}</button>
          </div>
        </div>

        {/* 文件树 */}
        <div className="fp-section">
          {changes.length === 0 ? (
            <div className="fp-empty">{t('无文件改动')}</div>
          ) : (
            sortedChildren.map(c => renderNode(c, 0))
          )}
        </div>

        {/* diff 查看器（P3）：同一时刻只展开一个 */}
        {openChange && <FileDiffViewer file={openChange} patch={patchCache[openChange.path]} onClose={() => setOpenFile(null)} />}

        {/* 附件（保留原分组） */}
        <div className="fp-section">
          <div className="fp-section-title">{t('附件')}</div>
          {attachments.length === 0 ? (
            <div className="fp-empty">{t('无附件')}</div>
          ) : attachments.map((f, i) => (
            <div key={i} className="fp-file-item">
              <span className="fp-file-icon"><Icon name={f.icon} size={14} ariaHidden /></span>
              <span className="fp-file-name">{f.name}</span>
            </div>
          ))}
        </div>

        {/* 工具文件（保留原分组） */}
        <div className="fp-section">
          <div className="fp-section-title">{t('工具文件')}</div>
          {toolFiles.length === 0 ? (
            <div className="fp-empty">{t('无文件操作')}</div>
          ) : toolFiles.map((f, i) => (
            <div key={i} className="fp-file-item">
              <span className="fp-file-icon"><Icon name={f.icon} size={14} ariaHidden /></span>
              <span className="fp-file-name" title={f.path}>{f.name}</span>
              {f.path && (
                <button
                  onClick={() => openDirectory(dirOf(f.path!))}
                  title={t('打开所在目录')}
                  className="fp-file-del"
                  style={{ marginLeft: 'auto' }}
                ><Icon name="folder-open" size={13} ariaHidden /></button>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
