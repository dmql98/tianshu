import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/i18n'
import Icon from '@/features/icons/Icon'
import {
  fetchKnowledgeBases,
  fetchKnowledgeFiles,
  fetchKnowledgeFileContent,
  createKnowledgeBase,
  deleteKnowledgeBase,
  type KnowledgeBase,
  type KnowledgeFileEntry,
} from '@/api/knowledge'
import FolderPicker from '@/components/Chat/FolderPicker'
import KnowledgePreview from './knowledge/KnowledgePreview'

type TabKey = 'files' | 'debug' | 'cite' | 'graph' | 'eval'

/** 目录树节点（由扁平文件列表构建）。 */
interface TreeNode {
  name: string
  dir: string
  children: TreeNode[]
  file?: KnowledgeFileEntry
}

function buildTree(files: KnowledgeFileEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  const map = new Map<string, TreeNode>()
  for (const f of files) {
    const dirs = f.dir ? f.dir.split('/') : []
    let cur = root
    let acc = ''
    for (const d of dirs) {
      acc = acc ? `${acc}/${d}` : d
      let node = map.get(acc)
      if (!node) {
        node = { name: d, dir: acc, children: [] }
        map.set(acc, node)
        cur.push(node)
      }
      cur = node.children
    }
    cur.push({ name: f.name, dir: f.dir, children: [], file: f })
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const ad = a.children.length > 0 ? 0 : 1
      const bd = b.children.length > 0 ? 0 : 1
      if (ad !== bd) return ad - bd
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.children.length > 0) sortRec(n.children)
  }
  sortRec(root)
  return root
}

export default function KnowledgePage() {
  const t = useI18n()
  const [bases, setBases] = useState<KnowledgeBase[]>([])
  const [activeKbId, setActiveKbId] = useState<string | null>(null)
  const [files, setFiles] = useState<KnowledgeFileEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<KnowledgeFileEntry | null>(null)
  const [content, setContent] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [tab, setTab] = useState<TabKey>('files')
  const [showCreate, setShowCreate] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createPath, setCreatePath] = useState('')
  const [createError, setCreateError] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<import('@/api/knowledge').KnowledgeSearchHit[] | null>(null)

  const refreshBases = useCallback(async () => {
    const r = await fetchKnowledgeBases()
    setBases(r.bases)
    return r.bases
  }, [])

  useEffect(() => { void refreshBases() }, [refreshBases])

  // 默认选中第一个库
  useEffect(() => {
    if (!activeKbId && bases.length > 0) setActiveKbId(bases[0].id)
    if (bases.length === 0) { setFiles([]); setSelectedFile(null); setContent('') }
  }, [bases, activeKbId])

  useEffect(() => {
    if (!activeKbId) { setFiles([]); setSelectedFile(null); setContent(''); return }
    setLoadingFiles(true)
    fetchKnowledgeFiles(activeKbId)
      .then(r => {
        setFiles(r.files)
        setSelectedFile(null)
        setContent('')
      })
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [activeKbId])

  const selectFile = async (f: KnowledgeFileEntry) => {
    if (!activeKbId) return
    setSelectedFile(f)
    setContent('')
    try {
      const r = await fetchKnowledgeFileContent(activeKbId, f.relPath)
      setContent(r.content)
    } catch { setContent('') }
  }

  const activeKb = bases.find(b => b.id === activeKbId) || null

  const openFolderPicker = () => {
    const api = window.tianshuDesktop
    if (api?.openDirectoryDialog) {
      void api.openDirectoryDialog(undefined, t('选择知识库目录')).then((dir) => {
        if (dir) setCreatePath(dir)
      }).catch(() => setShowFolderPicker(true))
      return
    }
    setShowFolderPicker(true)
  }

  const submitCreate = async () => {
    setCreateError('')
    if (!createName.trim()) { setCreateError(t('名称不能为空')); return }
    if (!createPath.trim()) { setCreateError(t('路径不能为空')); return }
    try {
      const r = await createKnowledgeBase({ name: createName.trim(), description: createDesc.trim(), rootPath: createPath.trim() })
      await refreshBases()
      setActiveKbId(r.kb.id)
      setShowCreate(false)
      setCreateName(''); setCreateDesc(''); setCreatePath('')
    } catch (err: any) {
      setCreateError(err.message || t('创建失败'))
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('确定删除该知识库？目录文件不会被删除。'))) return
    try {
      await deleteKnowledgeBase(id)
      if (activeKbId === id) setActiveKbId(null)
      await refreshBases()
    } catch { /* ignore */ }
  }

  const runSearch = async () => {
    if (!query.trim()) return
    try {
      const { searchKnowledgeApi } = await import('@/api/knowledge')
      const r = await searchKnowledgeApi(query.trim(), activeKbId ? [activeKbId] : undefined, 20)
      setHits(r.hits)
    } catch { setHits([]) }
  }

  const tree = buildTree(files)

  return (
    <main className="main">
      <div className="page-header">
        <div className="page-header-left">
          <span className="page-title">{t('知识库')}</span>
          <span className="page-desc">{t('管理和检索您的文档资源')}</span>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => setShowCreate(true)}>
            <Icon name="add" size={13} ariaHidden /> {t('新建知识库')}
          </button>
        </div>
      </div>

      <div className="knowledge-tabs">
        {([['files', '文件'], ['debug', '检索调试'], ['cite', '引用预览'], ['graph', '图谱探索'], ['eval', '评测']] as [TabKey, string][]).map(([k, label]) => (
          <div key={k} className={`knowledge-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{t(label)}</div>
        ))}
      </div>

      <div className="knowledge-content">
        {/* 左栏：知识库列表 */}
        <div className="tree-panel">
          <div className="tree-header">
            <span className="tree-title">{t('知识库')}</span>
            <button className="tree-add" title={t('新建知识库')} onClick={() => setShowCreate(true)}>+</button>
          </div>
          <div className="tree-body">
            {bases.length === 0 ? (
              <div className="tree-empty">{t('暂无知识库')}</div>
            ) : bases.map(kb => (
              <div key={kb.id} className={`tree-item ${kb.id === activeKbId ? 'active' : ''}`} onClick={() => setActiveKbId(kb.id)}>
                <span className="icon" style={{ display: 'inline-flex' }}><Icon name="folder-open" size={13} ariaHidden /></span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kb.name}</span>
                <button
                  className="tree-del"
                  title={t('删除')}
                  onClick={(e) => { e.stopPropagation(); void handleDelete(kb.id) }}
                >×</button>
              </div>
            ))}
          </div>
        </div>

        {/* 中栏 + 右栏 */}
        {tab === 'files' && (
          <>
            {/* 中栏：目录树 + 文档列表 */}
            <div className="doc-panel">
              <div className="doc-header">
                <span className="doc-title">{t('文档列表')}</span>
                <span className="doc-count">{t('{n} 个文件', { n: files.length })}</span>
              </div>
              <div className="doc-breadcrumb">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="home" size={12} ariaHidden /> {activeKb ? activeKb.name : t('知识库')}
                </span>
              </div>
              <div className="doc-body">
                {loadingFiles ? (
                  <div className="doc-empty-desc">{t('加载中...')}</div>
                ) : !activeKb ? (
                  <>
                    <div className="doc-empty-icon"><Icon name="folder-open" size={20} ariaHidden /></div>
                    <div className="doc-empty-title">{t('暂无知识库')}</div>
                    <div className="doc-empty-desc">{t('点击右上角新建知识库')}</div>
                  </>
                ) : files.length === 0 ? (
                  <>
                    <div className="doc-empty-icon"><Icon name="folder-open" size={20} ariaHidden /></div>
                    <div className="doc-empty-title">{t('暂无文档')}</div>
                    <div className="doc-empty-desc">{t('把 Markdown 文件放入该目录即可被识别', {})} · {activeKb.rootPath}</div>
                  </>
                ) : (
                  <div className="doc-tree">
                    {tree.map(node => <TreeItem key={node.dir + '/' + node.name} node={node} selectedRel={selectedFile?.relPath} onSelect={selectFile} />)}
                  </div>
                )}
              </div>
            </div>

            {/* 右栏：预览 */}
            <div className="preview-panel">
              <div className="preview-header">{t('文档预览')}</div>
              <KnowledgePreview file={selectedFile} content={content} />
            </div>
          </>
        )}

        {tab === 'debug' && (
          <div className="doc-panel">
            <div className="doc-header">
              <span className="doc-title">{t('检索调试')}</span>
            </div>
            <div className="debug-body">
              <div className="debug-search">
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('输入查询词...')} onKeyDown={e => { if (e.key === 'Enter') void runSearch() }} />
                <button className="btn sm" onClick={() => void runSearch()}><Icon name="search" size={12} ariaHidden /> {t('搜索')}</button>
              </div>
              {hits && (
                <div className="debug-results">
                  {hits.length === 0 ? <div className="doc-empty-desc">{t('无命中')}</div> : hits.map((h, i) => (
                    <div key={h.handle} className="result-card">
                      <div className="rc-head">
                        <span className="rc-idx">#{i + 1}</span>
                        <span className="rc-score">score {h.score}</span>
                        <span className="rc-source">{h.kbName} · {h.relPath} · {h.startLine} 行</span>
                      </div>
                      <div className="rc-content">{h.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="note-box" style={{ marginTop: 12 }}>{t('F1 阶段仅提供词法评分（score_md），向量/混合检索见后续阶段。')}</div>
            </div>
          </div>
        )}

        {tab === 'cite' && (
          <div className="doc-panel">
            <div className="doc-header"><span className="doc-title">{t('引用预览')}</span></div>
            <div className="debug-body"><div className="note-box">{t('F1 阶段：会话中由知识库工具返回的命中会以引用卡片形式展示，此处为规划占位。')}</div></div>
          </div>
        )}

        {tab === 'graph' && (
          <div className="doc-panel">
            <div className="doc-header"><span className="doc-title">{t('图谱探索')}</span></div>
            <div className="debug-body"><div className="note-box">{t('文档图谱 + PPR 增强检索为后续阶段（P2），F1 不包含。')}</div></div>
          </div>
        )}

        {tab === 'eval' && (
          <div className="doc-panel">
            <div className="doc-header"><span className="doc-title">{t('评测')}</span></div>
            <div className="debug-body"><div className="note-box">{t('检索评测（Recall/MRR/引用正确率）为后续阶段，F1 不包含。')}</div></div>
          </div>
        )}
      </div>

      {/* 新建知识库弹窗 */}
      {showCreate && (
        <div className="approval-overlay" onClick={() => setShowCreate(false)}>
          <div className="knowledge-create" onClick={e => e.stopPropagation()}>
            <div className="kc-head">
              <span className="kc-title">{t('新建知识库')}</span>
              <button className="fpk-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="kc-body">
              <label className="kc-label">{t('名称')}</label>
              <input className="kc-input" value={createName} onChange={e => setCreateName(e.target.value)} placeholder={t('例如：产品手册库')} />
              <label className="kc-label">{t('描述')}</label>
              <input className="kc-input" value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder={t('可选')} />
              <label className="kc-label">{t('目录路径')}</label>
              <div className="kc-path-row">
                <input className="kc-input" value={createPath} onChange={e => setCreatePath(e.target.value)} placeholder={t('C:\\path\\to\\docs')} />
                <button className="btn sm" onClick={openFolderPicker}><Icon name="folder" size={12} ariaHidden /> {t('浏览')}</button>
              </div>
              {createError && <div className="kc-error">{createError}</div>}
              <div className="kc-note">{t('知识库 = 一个目录，其下所有 Markdown 文件（递归）即文档集合。')}</div>
            </div>
            <div className="kc-footer">
              <button className="btn" onClick={() => setShowCreate(false)}>{t('取消')}</button>
              <button className="btn primary" onClick={() => void submitCreate()}>{t('创建')}</button>
            </div>
          </div>
        </div>
      )}

      {showFolderPicker && (
        <FolderPicker
          onSelect={(p) => { setCreatePath(p); setShowFolderPicker(false) }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </main>
  )
}

function TreeItem({ node, selectedRel, onSelect }: {
  node: TreeNode
  selectedRel?: string
  onSelect: (f: KnowledgeFileEntry) => void
}) {
  const [open, setOpen] = useState(true)
  if (node.file) {
    const active = node.file.relPath === selectedRel
    return (
      <div className={`doc-row ${active ? 'active' : ''}`} onClick={() => void onSelect(node.file!)}>
        <span className="doc-ic"><Icon name="file" size={16} ariaHidden /></span>
        <div className="doc-main">
          <div className="doc-name">{node.file.name}</div>
          <div className="doc-sub">
            <span className="tag">{node.file.ext.replace('.', '')}</span>
            <span>{node.file.size} B</span>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="doc-tree-node">
      <div className={`tree-item ${open ? '' : 'collapsed'}`} onClick={() => setOpen(v => !v)}>
        <span className="icon" style={{ display: 'inline-flex' }}><Icon name={open ? 'folder-open' : 'folder'} size={13} ariaHidden /></span>
        <span>{node.name}</span>
      </div>
      {open && node.children.map((c, i) => <TreeItem key={node.dir + '/' + c.name + i} node={c} selectedRel={selectedRel} onSelect={onSelect} />)}
    </div>
  )
}
