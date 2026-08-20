import { useParams } from 'react-router-dom'
import SkinVisualEditor from '@/features/skins/SkinVisualEditor'
import { useI18n } from '@/i18n'

export default function SkinDetailPage() {
  const t = useI18n()
  const { id } = useParams<{ id: string }>()
  if (!id) return <div className="empty-state">{t('未指定皮肤')}</div>
  return (
    <div className="main">
      <div className="page-header">
        <span className="page-title">{t('皮肤详情')}</span>
        <div className="header-actions">
          <a className="btn" href="#/skins" onClick={(e) => { e.preventDefault(); window.history.back() }}>{t('返回')}</a>
        </div>
      </div>
      <div className="content">
        <SkinVisualEditor skinId={id} />
      </div>
    </div>
  )
}
