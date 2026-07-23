import { useChatStore } from '@/stores/chatStore'
import { useCharactersStore } from '@/stores/charactersStore'
import { useUIStore } from '@/stores/uiStore'

export default function SidePanel() {
  const { sessions, activeSessionId, tokenUsage } = useChatStore()
  const { getById } = useCharactersStore()
  const { toggleRightPanel } = useUIStore()

  const session = sessions.find(s => s.id === activeSessionId)
  const character = session ? getById(session.character_id) : null

  return (
    <aside className="right-panel">
      <div className="rp-header">
        <span className="rp-title">{character ? `${character.name} · ${character.title}` : '星官详情'}</span>
        <span className="rp-close" onClick={toggleRightPanel}>✕</span>
      </div>
      <div className="rp-body">
        {character ? (
          <>
            <div className="rp-art-card">
              <div className="rp-art" style={{
                background: `linear-gradient(135deg, ${character.color}15, ${character.color}08)`
              }}>
                {character.icon}
              </div>
              <div className="rp-art-info">
                <div className="rp-art-name">{character.name}</div>
                <div className="rp-art-title">{character.title}</div>
                <div className="rp-art-desc">{character.desc}</div>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">运行配置</div>
              <div className="rp-row">
                <span className="label">模型服务</span>
                <span className="value">{character.provider}</span>
              </div>
              <div className="rp-row">
                <span className="label">模型</span>
                <span className="value">{character.model}</span>
              </div>
              <div className="rp-row">
                <span className="label">策略</span>
                <span className="value">{character.default_strategy}</span>
              </div>
              <div className="rp-row">
                <span className="label">角色类型</span>
                <span className="value">{character.role === 'both' ? '主/子 Agent' : character.role === 'main' ? '主 Agent' : '子 Agent'}</span>
              </div>
              <div className="rp-row">
                <span className="label">最大步数</span>
                <span className="value">{character.max_steps}</span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">项目区</div>
              <div className="rp-row">
                <span className="label" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {session?.workspace || 'C:\\.Tianshu'}
                </span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                授权工作区
                <button style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 14 }} title="添加路径">+</button>
              </div>
              <div className="rp-row">
                <span className="label" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {session?.workspace || 'C:\\.Tianshu'}
                </span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">运行状态</div>
              <div className="rp-row">
                <span className="label">上下文</span>
                <span className="value">12.4K / 128K</span>
              </div>
              <div className="rp-meter">
                <div className="fill" style={{ width: '10%' }}></div>
              </div>
              <div className="rp-row" style={{ marginTop: 6 }}>
                <span className="label">缓存命中</span>
                <span className="value" style={{ color: 'var(--jade)' }}>62%</span>
              </div>
              <div className="rp-row">
                <span className="label">当前策略</span>
                <span className="value">{character.default_strategy}</span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                绑定知识库
                <button style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 14 }} title="绑定知识库">+</button>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">能力</div>
              <div className="rp-row">
                <span className="label">技能</span>
                <span className="value">{character.skills.length} 个</span>
              </div>
              <div className="rp-row">
                <span className="label">工具</span>
                <span className="value">{character.tools.length} 个就绪</span>
              </div>
            </div>
            <div className="rp-section">
              <div className="rp-section-title">会话统计</div>
              <div className="rp-stats">
                <div className="rp-stat">
                  <div className="rp-stat-value">{session?.messages.length || 0}</div>
                  <div className="rp-stat-label">消息</div>
                </div>
                <div className="rp-stat">
                  <div className="rp-stat-value">{tokenUsage.total}</div>
                  <div className="rp-stat-label">Tokens</div>
                </div>
                <div className="rp-stat">
                  <div className="rp-stat-value">0</div>
                  <div className="rp-stat-label">工具调用</div>
                </div>
                <div className="rp-stat">
                  <div className="rp-stat-value">0</div>
                  <div className="rp-stat-label">事件</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-hint">选择一个会话查看详情</div>
          </div>
        )}
      </div>
    </aside>
  )
}
