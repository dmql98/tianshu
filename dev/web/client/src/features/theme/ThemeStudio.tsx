/**
 * 自定义主题工作台（TIANSHU_THEME_SWITCHING_PLAN §4.2）。
 *
 * - 选择或拖入本地 JPEG/PNG/静态 WebP；校验类型、大小并真实解码。
 * - 降采样 → 自动取色 → 建议外观 → 生成完整色板（对比度校正内置）。
 * - 预览中拖动调节焦点，与水平/垂直滑块双向同步（归一化 0..1）。
 * - 色板手动编辑 + 实时对比度提示 + 自动修正；撤销/重做/重新取色/重置。
 * - 真实界面预览覆盖首页（较强背景）与任务页（较弱背景）。
 * - 保存走服务端 multipart API（图片与主题事实存 <dataDir>/themes）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { BUILTIN_THEME_LIGHT, type Appearance, type ThemeDefinition, type ThemeTokens } from './themeDefinitions'
import { contrastRatio, adjustToContrast, AA_TEXT_CONTRAST } from './contrast'
import { extractColorsFromPixels, downsampleImageData, generatePalette, type GeneratedPalette } from './colorExtraction'
import { createTheme, updateTheme } from './themeApi'

export interface ThemeStudioProps {
  /** 编辑中的主题（undefined = 新建）。 */
  editing?: ThemeDefinition
  onClose: () => void
  onSaved: (theme: ThemeDefinition) => void
  showToast: (msg: string, type?: 'ok' | 'err') => void
}

export interface StudioArtworkState {
  focusX: number
  focusY: number
  scale: number
  homeOpacity: number
  taskOpacity: number
  dim: number
}

export interface StudioSnapshot {
  name: string
  appearance: Appearance
  tokens: ThemeTokens
  artwork: StudioArtworkState
}

const MAX_CLIENT_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export function cloneSnapshot(s: StudioSnapshot): StudioSnapshot {
  return { ...s, tokens: { ...s.tokens }, artwork: { ...s.artwork } }
}

export function snapshotEquals(a: StudioSnapshot, b: StudioSnapshot): boolean {
  if (a.appearance !== b.appearance || a.name !== b.name) return false
  for (const key of Object.keys(a.tokens) as (keyof ThemeTokens)[]) {
    if (a.tokens[key] !== b.tokens[key]) return false
  }
  return a.artwork.focusX === b.artwork.focusX &&
    a.artwork.focusY === b.artwork.focusY &&
    a.artwork.scale === b.artwork.scale &&
    a.artwork.homeOpacity === b.artwork.homeOpacity &&
    a.artwork.taskOpacity === b.artwork.taskOpacity &&
    a.artwork.dim === b.artwork.dim
}

const paletteToTokens = (p: GeneratedPalette): ThemeTokens => ({
  ...p,
  // overlay：深色画布用更重的黑色遮罩，浅色画布用暖棕遮罩
  overlay: contrastRatio(p.canvas, '#000000') > 3 ? 'rgba(0,0,0,0.55)' : 'rgba(44,36,24,0.4)',
})

export default function ThemeStudio({ editing, onClose, onSaved, showToast }: ThemeStudioProps) {
  const [history, setHistory] = useState<StudioSnapshot[]>(() => [
    {
      name: editing?.name ?? '我的主题',
      appearance: editing?.appearance ?? 'light',
      tokens: editing?.tokens ?? BUILTIN_THEME_LIGHT.tokens,
      artwork: {
        focusX: editing?.artwork?.focusX ?? 0.5,
        focusY: editing?.artwork?.focusY ?? 0.5,
        scale: editing?.artwork?.scale ?? 1,
        homeOpacity: editing?.artwork?.homeOpacity ?? 0.8,
        taskOpacity: editing?.artwork?.taskOpacity ?? 0.35,
        dim: editing?.artwork?.dim ?? 0.2,
      },
    },
  ])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [candidates, setCandidates] = useState<string[]>(editing ? [editing.tokens.accent] : [])
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState<string | undefined>(editing?.artwork?.url)
  const [imageSize, setImageSize] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [previewPage, setPreviewPage] = useState<'home' | 'task'>('home')
  const previewRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ active: boolean }>({ active: false })

  const snapshot = history[historyIndex]

  const push = useCallback((next: StudioSnapshot) => {
    setHistory(prev => {
      const base = prev.slice(0, historyIndex + 1)
      const tail = [...base, cloneSnapshot(next)]
      if (tail.length > 60) tail.shift()
      setHistoryIndex(tail.length - 1)
      return tail
    })
  }, [historyIndex])

  const patch = useCallback((patchFn: (s: StudioSnapshot) => StudioSnapshot) => {
    push(patchFn(cloneSnapshot(snapshot)))
  }, [snapshot, push])

  // ── 撤销 / 重做 ──
  const undo = useCallback(() => setHistoryIndex(i => Math.max(0, i - 1)), [])
  const redo = useCallback(() => setHistoryIndex(i => Math.min(history.length - 1, i + 1)), [history.length])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ── 图片解码与取色 ──
  const handleImageFile = useCallback(async (file: File) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      showToast('仅支持 JPEG / PNG / 静态 WebP 图片', 'err')
      return
    }
    if (file.size > MAX_CLIENT_IMAGE_BYTES) {
      showToast('图片超过 15 MB 限制', 'err')
      return
    }
    try {
      const decoded = await decodeImageFile(file)
      if (decoded.width * decoded.height > 40_000_000) {
        showToast('图片像素过大（超过 4000 万像素）', 'err')
        return
      }
      setImageFile(file)
      setImageUrl(URL.createObjectURL(file))
      setImageSize(`${decoded.width} × ${decoded.height}`)

      const down = downsampleImageData(decoded.data, decoded.width, decoded.height)
      const extracted = extractColorsFromPixels(down.data, down.width, down.height)
      setCandidates(extracted.candidates)

      // 外观：保留用户明确选择；新建时用算法建议
      setHistory(prev => {
        const current = cloneSnapshot(prev[prev.length - 1] ?? {
          name: editing?.name ?? '我的主题',
          appearance: 'light',
          tokens: BUILTIN_THEME_LIGHT.tokens,
          artwork: { focusX: 0.5, focusY: 0.5, scale: 1, homeOpacity: 0.8, taskOpacity: 0.35, dim: 0.2 },
        })
        const appearance: Appearance = editing ? current.appearance : extracted.suggestedAppearance
        const palette = generatePalette(extracted.candidates, { appearance })
        const next: StudioSnapshot = {
          name: current.name,
          appearance,
          tokens: paletteToTokens(palette),
          artwork: { ...current.artwork },
        }
        setHistoryIndex(0)
        return [cloneSnapshot(next)]
      })
      showToast('已提取主题色（可手动微调）')
    } catch {
      showToast('图片解码失败，请换一张图片', 'err')
    }
  }, [editing, showToast])

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleImageFile(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleImageFile(file)
  }

  const reExtract = async () => {
    if (!imageUrl || extracting) return
    setExtracting(true)
    try {
      if (imageFile) {
        await handleImageFile(imageFile)
        return
      }
      const response = await fetch(imageUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const type = blob.type || 'image/webp'
      const file = new File([blob], 'theme-background', { type })
      await handleImageFile(file)
    } catch {
      showToast('重新取色失败，无法读取背景图片', 'err')
    } finally {
      setExtracting(false)
    }
  }

  // ── 外观切换（保留色板候选重新生成） ──
  const handleAppearance = (appearance: Appearance) => {
    patch(s => ({
      ...s,
      appearance,
      tokens: paletteToTokens(generatePalette(candidates.length ? candidates : [s.tokens.accent], { appearance })),
    }))
  }

  // ── 颜色编辑 ──
  const handleTokenColor = (key: keyof ThemeTokens, value: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return
    patch(s => ({ ...s, tokens: { ...s.tokens, [key]: value.toLowerCase() } }))
  }

  // ── 对比度信息 ──
  const contrastRows: { label: string; key: keyof ThemeTokens; fg: string; bg: string }[] = [
    { label: '正文 / 背景', key: 'textPrimary', fg: snapshot.tokens.textPrimary, bg: snapshot.tokens.canvas },
    { label: '次要文字 / 背景', key: 'textSecondary', fg: snapshot.tokens.textSecondary, bg: snapshot.tokens.canvas },
    { label: '强调色上的文字', key: 'textOnAccent', fg: snapshot.tokens.textOnAccent, bg: snapshot.tokens.accent },
    { label: '面板上的正文', key: 'textPrimary', fg: snapshot.tokens.textPrimary, bg: snapshot.tokens.surface1 },
  ]

  const fixContrast = (key: keyof ThemeTokens, fg: string, bg: string) => {
    handleTokenColor(key, adjustToContrast(bg, fg, AA_TEXT_CONTRAST))
  }

  // ── 焦点拖动（预览图） ──
  const updateFocusFromPointer = (e: React.PointerEvent) => {
    const el = previewRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    patch(s => ({ ...s, artwork: { ...s.artwork, focusX: x, focusY: y } }))
  }

  // ── 保存 ──
  const handleSave = async () => {
    setSaving(true)
    try {
      const colors: Record<string, string> = {}
      for (const key of Object.keys(snapshot.tokens) as (keyof ThemeTokens)[]) {
        colors[key] = snapshot.tokens[key]
      }
      const artwork = {
        focusX: snapshot.artwork.focusX,
        focusY: snapshot.artwork.focusY,
        scale: snapshot.artwork.scale,
        homeOpacity: snapshot.artwork.homeOpacity,
        taskOpacity: snapshot.artwork.taskOpacity,
        dim: snapshot.artwork.dim,
      }
      const common = {
        name: snapshot.name,
        appearance: snapshot.appearance,
        colors,
        artwork,
        background: imageFile ?? undefined,
      }
      const saved = editing
        ? await updateTheme(editing.id, common)
        : await createTheme(common)
      onSaved(saved)
      showToast('主题已保存')
    } catch (err: any) {
      showToast(`保存失败：${err?.message ?? '网络错误'}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const tokensStyle = {
    '--theme-canvas': snapshot.tokens.canvas,
    '--theme-surface-1': snapshot.tokens.surface1,
    '--theme-surface-2': snapshot.tokens.surface2,
    '--theme-input': snapshot.tokens.input,
    '--theme-text-primary': snapshot.tokens.textPrimary,
    '--theme-text-secondary': snapshot.tokens.textSecondary,
    '--theme-text-muted': snapshot.tokens.textMuted,
    '--theme-accent': snapshot.tokens.accent,
    '--theme-border': snapshot.tokens.border,
    '--theme-backdrop-image': imageUrl ? `url("${imageUrl}")` : 'none',
    '--theme-backdrop-focus-x': `${snapshot.artwork.focusX * 100}%`,
    '--theme-backdrop-focus-y': `${snapshot.artwork.focusY * 100}%`,
    '--theme-backdrop-scale': String(snapshot.artwork.scale),
    '--theme-backdrop-home-opacity': String(snapshot.artwork.homeOpacity),
    '--theme-backdrop-task-opacity': String(snapshot.artwork.taskOpacity),
    '--theme-backdrop-dim': String(snapshot.artwork.dim),
  } as React.CSSProperties

  return (
    <div className="theme-studio-overlay">
      <div className="theme-studio">
        <div className="theme-studio-header">
          <span className="theme-studio-title">{editing ? '编辑主题' : '创建自定义主题'}</span>
          <button type="button" className="theme-studio-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="theme-studio-body">
          {/* 左：真实界面预览 */}
          <div className="theme-studio-preview">
            <div className="studio-preview-tabs" role="tablist" aria-label="预览页面">
              <button
                type="button" role="tab" aria-selected={previewPage === 'home'}
                className={`studio-preview-tab ${previewPage === 'home' ? 'active' : ''}`}
                onClick={() => setPreviewPage('home')}
              >首页预览</button>
              <button
                type="button" role="tab" aria-selected={previewPage === 'task'}
                className={`studio-preview-tab ${previewPage === 'task' ? 'active' : ''}`}
                onClick={() => setPreviewPage('task')}
              >任务页预览</button>
              {imageUrl && <span className="studio-preview-help">在界面中拖动可调整背景焦点</span>}
            </div>

            {/* 完整应用界面预览，同时也是背景焦点编辑器。 */}
            <div
              className={`studio-preview-frame ${previewPage}`}
              style={tokensStyle}
              ref={previewRef}
              onPointerDown={(e) => {
                if (!imageUrl) return
                dragState.current.active = true
                e.currentTarget.setPointerCapture(e.pointerId)
                updateFocusFromPointer(e)
              }}
              onPointerMove={(e) => { if (dragState.current.active) updateFocusFromPointer(e) }}
              onPointerUp={(e) => {
                dragState.current.active = false
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
              }}
              onPointerCancel={() => { dragState.current.active = false }}
            >
              <div
                className="studio-backdrop"
                aria-hidden="true"
                style={{
                  opacity: previewPage === 'home' ? snapshot.artwork.homeOpacity : snapshot.artwork.taskOpacity,
                  backgroundImage: imageUrl ? `url("${imageUrl}")` : 'none',
                  transform: `scale(${snapshot.artwork.scale})`,
                }}
              />
              <div className="studio-backdrop-dim" aria-hidden="true" />
              <div className="studio-preview-ui">
                <aside className="studio-preview-rail">
                  <i className="studio-preview-logo">枢</i>
                  {['●', '◆', '⚡', '✦', '▣'].map((icon, index) => <i key={index}>{icon}</i>)}
                  <i className="bottom">⚙</i>
                </aside>

                {previewPage === 'task' && (
                  <aside className="studio-preview-session">
                    <strong>会话</strong><span>☰</span>
                    <div className="studio-preview-search">搜索会话…</div>
                    <div className="studio-preview-new">＋ 新建项目</div>
                    <small>项目</small>
                    <div className="studio-preview-project active">天枢主题设计</div>
                    <div className="studio-preview-project">日常助手</div>
                    <div className="studio-preview-project">资料整理</div>
                  </aside>
                )}

                <main className="studio-preview-main">
                  {previewPage === 'home' ? (
                    <div className="studio-preview-home">
                      <div className="studio-preview-heading">让我们干些什么吧</div>
                      <div className="studio-preview-subheading">天枢，你的 AI Agent 系统</div>
                      <div className="studio-preview-composer">
                        <span>输入你的想法，让天枢来帮你实现…</span>
                        <div><span>＋　⚡　▣</span><b>↑</b></div>
                      </div>
                      <div className="studio-preview-pills"><i>搜索资料</i><i>写文档</i><i>写代码</i><i>更多</i></div>
                      <div className="studio-preview-cards"><i /><i /><i /></div>
                    </div>
                  ) : (
                    <div className="studio-preview-chat">
                      <div className="studio-preview-chat-title">天枢主题设计</div>
                      <div className="studio-preview-message user">我想让图片成为整个应用的背景。</div>
                      <div className="studio-preview-message assistant">
                        <strong>天枢</strong>
                        <span>背景会覆盖完整界面，同时保证侧栏、消息和按钮清晰可读。</span>
                      </div>
                      <div className="studio-preview-chat-input"><span>随便说点什么</span><b>↑</b></div>
                    </div>
                  )}
                </main>
              </div>
              {imageUrl && (
                <>
                  <div
                    className="studio-focus-crosshair"
                    style={{ left: `${snapshot.artwork.focusX * 100}%`, top: `${snapshot.artwork.focusY * 100}%` }}
                  />
                  <span className="studio-focus-hint">拖动界面调整焦点</span>
                </>
              )}
            </div>

            <div className="studio-focus-sliders">
              <label>
                水平焦点
                <input
                  type="range" min={0} max={100} value={Math.round(snapshot.artwork.focusX * 100)}
                  onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, focusX: Number(e.target.value) / 100 } }))}
                />
                <output>{Math.round(snapshot.artwork.focusX * 100)}%</output>
              </label>
              <label>
                垂直焦点
                <input
                  type="range" min={0} max={100} value={Math.round(snapshot.artwork.focusY * 100)}
                  onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, focusY: Number(e.target.value) / 100 } }))}
                />
                <output>{Math.round(snapshot.artwork.focusY * 100)}%</output>
              </label>
              <label>
                背景缩放
                <input
                  type="range" min={100} max={250} value={Math.round(snapshot.artwork.scale * 100)}
                  onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, scale: Number(e.target.value) / 100 } }))}
                />
                <output>{Math.round(snapshot.artwork.scale * 100)}%</output>
              </label>
            </div>
          </div>

          {/* 右：设置面板 */}
          <div className="theme-studio-settings">
            <div className="studio-field">
              <label className="studio-label">主题名称</label>
              <input
                type="text" value={snapshot.name} maxLength={40}
                onChange={e => patch(s => ({ ...s, name: e.target.value }))}
              />
            </div>

            <div className="studio-field">
              <label className="studio-label">背景图片</label>
              <div
                className={`studio-dropzone ${dragOver ? 'dragover' : ''} ${imageUrl ? 'has-image' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {imageUrl ? (
                  <>
                    <span className="studio-dropzone-ok">✓ 已选择图片{imageSize ? `（${imageSize}）` : ''}</span>
                    <button type="button" className="btn sm" onClick={() => {
                      setImageFile(null); setImageUrl(undefined); setImageSize(null)
                    }}>移除</button>
                  </>
                ) : (
                  <span>拖入图片，或</span>
                )}
                <label className="btn sm studio-pick-btn">
                  选择图片
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePickFile} hidden />
                </label>
              </div>
              {candidates.length > 0 && (
                <div className="studio-candidates">
                  {candidates.slice(0, 6).map((c, i) => (
                    <i key={i} title={c} style={{ background: c }} />
                  ))}
                  <button type="button" className="btn sm" onClick={() => void reExtract()} disabled={extracting}>
                    {extracting ? '取色中…' : '重新取色'}
                  </button>
                </div>
              )}
            </div>

            <div className="studio-field">
              <label className="studio-label">外观</label>
              <div className="studio-segmented" role="radiogroup" aria-label="外观">
                {(['light', 'dark'] as Appearance[]).map(a => (
                  <button
                    key={a} type="button" role="radio" aria-checked={snapshot.appearance === a}
                    className={snapshot.appearance === a ? 'active' : ''}
                    onClick={() => handleAppearance(a)}
                  >
                    {a === 'light' ? '浅色' : '深色'}
                  </button>
                ))}
              </div>
            </div>

            <div className="studio-field">
              <label className="studio-label">色板（对比度实时提示）</label>
              <div className="studio-palette">
                {contrastRows.map(row => {
                  const ratio = contrastRatio(row.fg, row.bg)
                  const pass = ratio >= AA_TEXT_CONTRAST
                  return (
                    <div className="studio-palette-row" key={row.label}>
                      <span className="studio-palette-swatch" style={{ background: row.fg }} />
                      <span className="studio-palette-label">{row.label}</span>
                      <span className={`studio-contrast ${pass ? 'pass' : 'fail'}`}>
                        {ratio.toFixed(2)}:1{pass ? ' ✓' : ' ✗'}
                      </span>
                      {!pass && (
                        <button
                          type="button" className="studio-fix-btn"
                          onClick={() => fixContrast(row.key, row.fg, row.bg)}
                        >
                          修正
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="studio-field">
              <label className="studio-label">背景强度</label>
              <div className="studio-sliders">
                <label>
                  首页不透明度
                  <input type="range" min={0} max={100} value={Math.round(snapshot.artwork.homeOpacity * 100)}
                    onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, homeOpacity: Number(e.target.value) / 100 } }))} />
                </label>
                <label>
                  任务页不透明度
                  <input type="range" min={0} max={100} value={Math.round(snapshot.artwork.taskOpacity * 100)}
                    onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, taskOpacity: Number(e.target.value) / 100 } }))} />
                </label>
                <label>
                  暗化
                  <input type="range" min={0} max={85} value={Math.round(snapshot.artwork.dim * 100)}
                    onChange={e => patch(s => ({ ...s, artwork: { ...s.artwork, dim: Number(e.target.value) / 100 } }))} />
                </label>
              </div>
            </div>

            <div className="studio-field">
              <label className="studio-label">微调色板</label>
              <div className="studio-token-grid">
                {Object.entries(snapshot.tokens).map(([key, value]) => (
                  <label className="studio-token" key={key}>
                    <input
                      type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'}
                      onChange={e => handleTokenColor(key as keyof ThemeTokens, e.target.value)}
                      aria-label={key}
                    />
                    <span title={value}>{key}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="theme-studio-footer">
          <div className="studio-undo-row">
            <button type="button" className="btn sm" onClick={undo} disabled={historyIndex === 0}>↶ 撤销</button>
            <button type="button" className="btn sm" onClick={redo} disabled={historyIndex >= history.length - 1}>↷ 重做</button>
            <span className="studio-history-count">{historyIndex + 1} / {history.length}</span>
          </div>
          <div className="studio-save-row">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button type="button" className="btn primary" onClick={handleSave} disabled={saving || !snapshot.name.trim()}>
              {saving ? '保存中…' : editing ? '保存修改' : '保存主题'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


/** 浏览器真实解码（canvas 降采样取色 + 尺寸/像素校验）。 */
async function decodeImageFile(file: File): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // fallback：HTMLImageElement 解码
    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode failed'))
      img.src = url
    })
    URL.revokeObjectURL(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(img, 0, 0)
    return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height }
}
