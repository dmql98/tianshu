import { useI18n } from '@/i18n'

export default function MarketPage() {
  const t = useI18n()

  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">{t('星河')}</span>
      </div>

      <div className="content">
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🚧</div>
          <div style={{ fontSize: 'calc(20px * var(--ui-font-scale))', fontWeight: 600, color: 'var(--ink-deep)', marginBottom: 8 }}>
            {t('正在开发中')}
          </div>
          <div style={{ fontSize: 'calc(13px * var(--ui-font-scale))', color: 'var(--ink-light)' }}>
            {t('市场功能正在加紧建设中，敬请期待')}
          </div>
        </div>
      </div>
    </main>
  )
}
