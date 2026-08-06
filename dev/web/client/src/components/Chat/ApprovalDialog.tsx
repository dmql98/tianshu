import { useChatStore } from '@/stores/chatStore'

export default function ApprovalDialog() {
  const { pendingApproval, respondApproval } = useChatStore()

  if (!pendingApproval) return null
  const isWorkspaceApproval = pendingApproval.approval_kind === 'workspace' && !!pendingApproval.permission_root

  return (
    <div className="approval-overlay">
      <div className="approval-dialog">
        <div className="approval-title">⚠️ {isWorkspaceApproval ? '工作区权限申请' : '操作确认'}</div>
        {isWorkspaceApproval ? (
          <div className="approval-workspace-request">
            将 <strong>{pendingApproval.permission_root}</strong> 添加到授权工作区
          </div>
        ) : (
          <>
            <div className="approval-desc">工具 <strong>{pendingApproval.tool_name}</strong> 请求执行以下操作：</div>
            <div className="approval-path">{pendingApproval.description}</div>
          </>
        )}
        <div className="approval-actions">
          <button className="approval-btn reject" onClick={() => respondApproval('reject')}>
            拒绝
          </button>
          <button className="approval-btn once" onClick={() => respondApproval('once')}>
            仅本次
          </button>
          <button className="approval-btn always" onClick={() => respondApproval('always')}>
            始终允许
          </button>
        </div>
      </div>
    </div>
  )
}
