/**
 * 极简首页（HOME_PAGE_DEVELOPMENT_PLAN §1/§3）。
 *
 * 只承担"回到最近对话"：
 * - 页面中央首页标题（来自当前实际生效主题；缺失回退默认值）。
 * - 最近更新的 3 个普通对话卡片（真实数据，按 updated_at 倒序）。
 * - "查看全部会话"入口（/chat）。
 *
 * 不含输入框、快捷操作、系统状态、统计或新建会话。
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchRecentSessions, type RecentSessionSummary } from '@/api/sessions'
import { fetchCharacters } from '@/api/characters'
import type { Character } from '@/types'
import { appliedHomeTitle } from '@/features/theme/themeRuntime'
import { DEFAULT_HOME_TITLE } from '@/features/theme/themeDefinitions'
import CharacterRenderer from '@/features/characters/CharacterRenderer'

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; sessions: RecentSessionSummary[] }
  | { status: 'error' }

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 本地日期。
 * 纯函数，便于测试。
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const date = new Date(ts)
  const today = new Date(now)
  const yesterday = new Date(now - 86_400_000)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  if (date.toDateString() === today.toDateString()) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function sessionTitle(session: RecentSessionSummary): string {
  return session.title?.trim() || '新会话'
}

function sessionPreview(session: RecentSessionSummary): string {
  return session.last_message_preview?.trim() || '暂无消息'
}

function RecentCard({
  session,
  character,
  onOpen,
}: {
  session: RecentSessionSummary
  character?: Character
  onOpen: (id: string) => void
}) {
  const name = character?.name?.trim() || 'Agent'
  return (
    <button
      type="button"
      className="home-card"
      onClick={() => onOpen(session.id)}
      aria-label={`打开会话：${sessionTitle(session)}`}
    >
      <span className="home-card-head">
        <CharacterRenderer
          characterId={session.character_id}
          name={name}
          mode="avatar"
          className="home-card-avatar"
          title={name}
        />
        <span className="home-card-meta">
          <span className="home-card-character">{name}</span>
          <span className="home-card-time">{formatRelativeTime(session.updated_at)}</span>
        </span>
      </span>
      <span className="home-card-title">{sessionTitle(session)}</span>
      <span className="home-card-preview">{sessionPreview(session)}</span>
    </button>
  )
}

function SkeletonCard() {
  return (
    <div className="home-card skeleton" aria-hidden="true">
      <span className="skeleton-head"><i /><i /></span>
      <span className="skeleton-line" /><span className="skeleton-line short" />
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState<string>(() => appliedHomeTitle())
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [characters, setCharacters] = useState<Record<string, Character>>({})
  const [retryKey, setRetryKey] = useState(0)
  const mounted = useRef(true)

  // 主题标题：初始化读取 + theme-changed 事件后重新读取
  useEffect(() => {
    mounted.current = true
    const onThemeChanged = () => setTitle(appliedHomeTitle())
    window.addEventListener('tianshu:theme-changed', onThemeChanged)
    return () => {
      mounted.current = false
      window.removeEventListener('tianshu:theme-changed', onThemeChanged)
    }
  }, [])

  // 数据：挂载拉取一次；从会话页返回时组件重新挂载自动刷新；重试按钮触发
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void Promise.allSettled([fetchRecentSessions(3), fetchCharacters()]).then(([sessionsRes, charsRes]) => {
      if (cancelled || !mounted.current) return
      if (sessionsRes.status === 'fulfilled') {
        setState({ status: 'ready', sessions: sessionsRes.value.slice(0, 3) })
      } else {
        setState({ status: 'error' })
      }
      if (charsRes.status === 'fulfilled') {
        setCharacters(Object.fromEntries(charsRes.value.map(c => [c.id, c])))
      }
      // 角色接口失败不阻塞卡片：characters 保持空映射 → 名称回退 Agent
    })
    return () => { cancelled = true }
  }, [retryKey])

  const openSession = (id: string) => navigate(`/chat/${encodeURIComponent(id)}`)
  const openAll = () => navigate('/chat')

  return (
    <main className="main">
      <div className="home">
        <h1 className="home-headline">{title || DEFAULT_HOME_TITLE}</h1>

        <section className="home-recent" aria-label="最近对话">
          <div className="home-recent-header">
            <span className="home-recent-title">最近对话</span>
            <button type="button" className="home-view-all" onClick={openAll}>
              查看全部会话 →
            </button>
          </div>

          {state.status === 'loading' && (
            <div className="home-card-grid" role="status" aria-label="加载中">
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          )}

          {state.status === 'error' && (
            <div className="home-state" role="alert">
              <span className="home-state-title">最近会话加载失败</span>
              <div className="home-state-actions">
                <button type="button" className="btn sm" onClick={() => setRetryKey(k => k + 1)}>重试</button>
                <button type="button" className="btn sm" onClick={openAll}>查看全部会话</button>
              </div>
            </div>
          )}

          {state.status === 'ready' && state.sessions.length === 0 && (
            <div className="home-state">
              <span className="home-state-title">暂无最近会话</span>
              <button type="button" className="btn sm" onClick={openAll}>前往会话页开始 →</button>
            </div>
          )}

          {state.status === 'ready' && state.sessions.length > 0 && (
            <div className="home-card-grid">
              {state.sessions.map(session => (
                <RecentCard
                  key={session.id}
                  session={session}
                  character={characters[session.character_id]}
                  onOpen={openSession}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
