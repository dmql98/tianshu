import { useUIStore } from '@/stores/uiStore'

export default function FilePanel() {
  const { toggleFilePanel } = useUIStore()

  return (
    <aside className="file-panel">
      <div className="fp-header">
        <span className="fp-title">文件</span>
        <span className="fp-close" onClick={toggleFilePanel}>✕</span>
      </div>
      <div className="fp-body">
        <div className="fp-section">
          <div className="fp-section-title">附件</div>
          <div className="fp-files" id="fpAttachments"></div>
        </div>
        <div className="fp-section">
          <div className="fp-section-title">输出文件</div>
          <div className="fp-files" id="fpOutputs"></div>
        </div>
      </div>
    </aside>
  )
}
