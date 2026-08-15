import { useChatStore } from '@/stores/chatStore'
import { useI18n } from '@/i18n'

export default function ApprovalDialog() {
  const { pendingApproval, respondApproval } = useChatStore()
  const t = useI18n()

  if (!pendingApproval) return null
  const isWorkspaceApproval = pendingApproval.approval_kind === 'workspace' && !!pendingApproval.permission_root

  return (
    <div className="approval-overlay">
      <div className="approval-dialog">
        <div className="approval-title">⚠️ {isWorkspaceApproval ? t('工作区权限申请') : t('操作确认')}</div>
        {isWorkspaceApproval ? (
          <div className="approval-workspace-request">
            {t('将')} <strong>{pendingApproval.permission_root}</strong> {t('添加到授权工作区')}
          </div>
        ) : (
          <>
            <div className="approval-desc"><strong>{pendingApproval.tool_name}</strong> {t('请求执行以下操作：')}</div>
            <div className="approval-path">{pendingApproval.description}</div>
          </>
        )}
        <div className="approval-actions">
          <button className="approval-btn reject" onClick={() => respondApproval('reject')}>
            {t('拒绝')}
          </button>
          <button className="approval-btn once" onClick={() => respondApproval('once')}>
            {t('仅本次')}
          </button>
          <button className="approval-btn always" onClick={() => respondApproval('always')}>
            {t('始终允许')}
          </button>
        </div>
      </div>
    </div>
  )
}
