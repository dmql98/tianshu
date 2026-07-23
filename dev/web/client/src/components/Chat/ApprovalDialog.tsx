import { useChatStore } from '@/stores/chatStore'

export default function ApprovalDialog() {
  const { pendingApproval, respondApproval } = useChatStore()

  if (!pendingApproval) return null

  return (
    <div className="approval-overlay">
      <div className="approval-dialog">
        <div className="approval-title">⚠️ 工作区权限申请</div>
        <div className="approval-desc">
          工具 <strong>{pendingApproval.tool_name}</strong> 需要访问工作区外的路径：
        </div>
        <div className="approval-path">{pendingApproval.description}</div>
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
