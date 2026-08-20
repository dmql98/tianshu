import { useParams, useNavigate } from 'react-router-dom'
import SkinVisualEditor from '@/features/skins/SkinVisualEditor'
import { useI18n } from '@/i18n'

export default function SkinDetailPage() {
  const t = useI18n()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  if (!id) return <div className="main"><div className="empty-state">{t('未指定皮肤')}</div></div>
  return (
    <div className="main">
      <div className="detail-header">
        <button className="back-btn" onClick={() => navigate('/characters')}>←</button>
        <div className="detail-header-info">
          <h1>{t('皮肤详情')}</h1>
          <p>{id}</p>
        </div>
        <div style={{ flex: 1 }}></div>
      </div>
      <div className="content">
        <SkinVisualEditor skinId={id} />
      </div>
    </div>
  )
}
