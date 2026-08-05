import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSkillPackage } from '@/api/skills'

export default function NewSkillPackagePage() {
  const navigate = useNavigate()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('general')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function slug(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  }

  async function save() {
    const packageId = slug(id)
    if (!packageId || !name.trim() || !category.trim() || !instructions.trim()) {
      setError('包 ID、名称、分类和根技能说明均为必填项')
      return
    }
    setSaving(true)
    setError('')
    const content = `---\nname: ${name.trim()}\ndescription: ${description.trim()}\nversion: ${version.trim() || '1.0.0'}\n---\n\n${instructions.trim()}\n`
    try {
      const created = await createSkillPackage({
        id: packageId,
        name: name.trim(),
        category: category.trim(),
        description: description.trim(),
        version: version.trim() || undefined,
        content,
      })
      navigate(`/skills/packages/${encodeURIComponent(created.category)}/${encodeURIComponent(created.id)}`, { replace: true })
    } catch (reason: any) {
      setError(reason?.message || '创建技能包失败')
    } finally {
      setSaving(false)
    }
  }

  return <div className="main">
    <div className="detail-header">
      <button className="back-btn" onClick={() => navigate('/skills')}>←</button>
      <div className="detail-header-info"><h1>新建技能包</h1><p>始终创建标准 skill-package.json 格式</p></div>
    </div>
    <div className="content" style={{ maxWidth: 900 }}>
      <div className="detail-section">
        <div className="detail-section-title">基本信息</div>
        <div className="info-grid">
          <label className="info-item"><span className="info-item-label">包 ID</span><input className="input" value={id} onChange={event => setId(event.target.value)} placeholder="my-skill-package" /></label>
          <label className="info-item"><span className="info-item-label">名称</span><input className="input" value={name} onChange={event => { setName(event.target.value); if (!id) setId(slug(event.target.value)) }} placeholder="技能包名称" /></label>
          <label className="info-item"><span className="info-item-label">分类</span><input className="input" value={category} onChange={event => setCategory(event.target.value)} placeholder="general" /></label>
          <label className="info-item"><span className="info-item-label">版本</span><input className="input" value={version} onChange={event => setVersion(event.target.value)} placeholder="1.0.0" /></label>
        </div>
        <label style={{ display: 'block', marginTop: 14 }}><span className="info-item-label">描述</span><input className="input" style={{ width: '100%' }} value={description} onChange={event => setDescription(event.target.value)} placeholder="这个技能包解决什么问题" /></label>
      </div>
      <div className="detail-section">
        <div className="detail-section-title">根技能说明</div>
        <textarea className="input" style={{ width: '100%', minHeight: 280, resize: 'vertical', lineHeight: 1.6 }} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="输入根技能的工作流程、规则和使用说明..." />
      </div>
      {error && <div style={{ color: '#ef4444', marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="detail-btn" onClick={() => navigate('/skills')}>取消</button>
        <button className="detail-btn primary" disabled={saving} onClick={save}>{saving ? '创建中...' : '创建标准技能包'}</button>
      </div>
    </div>
  </div>
}
