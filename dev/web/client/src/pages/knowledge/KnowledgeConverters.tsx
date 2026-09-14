import { useI18n } from '@/i18n'
import Icon from '@/features/icons/Icon'
import type { KnowledgeConverter } from '@/api/knowledge'

/**
 * P2 外部转换器卡片区（06 §3.7）：
 * 每张卡片显示一个转换器（PaddleOCR / AnyDoc），带探测状态 + 「安装」按钮。
 * 点击安装 → POST /converters/:id/detect（登记 + 探测 CLI），可用后即可在
 * 会话中通过 knowledge_manage(convert) 调用。
 */
export default function KnowledgeConverters({
  converters,
  loading,
  onInstall,
}: {
  converters: KnowledgeConverter[]
  loading: boolean
  onInstall: (id: string) => void
}) {
  const t = useI18n()
  if (converters.length === 0) return null
  return (
    <div className="converters-bar">
      <span className="converters-label"><Icon name="nav-knowledge" size={13} ariaHidden /> {t('外部转换器')}</span>
      <div className="converters-list">
        {converters.map(c => {
          const available = c.available
          return (
            <div key={c.id} className={`converter-card ${available ? 'ok' : ''}`}>
              <span className="converter-name">{c.name}</span>
              <span className={`converter-status ${available ? 'ok' : ''}`}>
                {available ? t('已检测') : t('未检测')}
              </span>
              {!c.installed && (
                <button className="btn sm" disabled={loading} onClick={() => onInstall(c.id)}>
                  <Icon name="add" size={11} ariaHidden /> {t('安装 {name}', { name: c.name })}
                </button>
              )}
              {c.installed && <span className="converter-installed">{t('已安装')}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
