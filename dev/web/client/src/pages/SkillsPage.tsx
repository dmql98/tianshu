export default function SkillsPage({ onSkillClick }: { onSkillClick?: () => void }) {
  const evolvedSkills = [
    {
      icon: '📄',
      name: '文档分析',
      desc: '分析文档内容，提取关键信息，支持 PDF、Word、TXT 等格式。',
      origin: 'evolved',
      bind: '长庚 文曲',
      usage: '2.4K',
      rate: '98%',
      spark: [50,70,55,85,65,100,80],
    },
    {
      icon: '🌐',
      name: '网页抓取',
      desc: '抓取网页内容，支持多种格式，自动提取正文与结构化数据。',
      origin: 'evolved',
      bind: '长庚',
      usage: '1.8K',
      rate: '96%',
      spark: [40,65,80,55,90,70,95],
    },
    {
      icon: '🔍',
      name: '代码审查',
      desc: '自动审查代码质量，发现潜在问题并提供改进建议。',
      origin: 'evolved',
      bind: '天璇',
      usage: '3.1K',
      rate: '99%',
      spark: [60,85,70,95,75,100,88],
    },
  ]

  const manualSkills = [
    {
      icon: '🎨',
      name: 'UI 设计',
      desc: 'UI/UX 设计建议和优化，生成设计稿与交互原型。',
      origin: 'manual',
      bind: '文曲',
      usage: '956',
      rate: '94%',
      spark: [35,60,45,75,55,80,65],
    },
    {
      icon: '📊',
      name: '数据分析',
      desc: '数据处理和可视化分析，生成图表与洞察报告。',
      origin: 'manual',
      bind: '天璇',
      usage: '1.2K',
      rate: '97%',
      spark: [45,75,60,90,70,85,95],
    },
  ]

  const marketSkills = [
    {
      icon: '🧪',
      name: '自动化测试',
      desc: '自动生成测试用例，执行自动化测试并生成报告。',
      origin: 'market',
      bind: '未绑定',
      usage: '0',
    },
  ]

  const renderSkillCard = (skill: any, idx: number) => (
    <div key={idx} className="skill-card" onClick={onSkillClick}>
      <div className="skill-card-header">
        <div className="skill-icon" style={{
          background: skill.origin === 'evolved' ? 'rgba(200,150,10,0.08)' :
                     skill.origin === 'manual' ? 'rgba(37,99,235,0.08)' :
                     'rgba(196,92,60,0.08)'
        }}>{skill.icon}</div>
        <div className="skill-name">{skill.name}</div>
      </div>
      <div className="skill-desc">{skill.desc}</div>
      <div className="skill-meta">
        <span className={`skill-origin ${skill.origin}`}>
          {skill.origin === 'evolved' ? '进化生成' : skill.origin === 'manual' ? '手动创建' : '星河市场'}
        </span>
        <span>绑定: {skill.bind}</span>
        <span>使用 {skill.usage} 次</span>
      </div>
      {skill.spark && (
        <div className="skill-foot">
          <span className="skill-rate">成功率 {skill.rate}</span>
          <div className="skill-spark">
            {skill.spark.map((h: number, i: number) => (
              <i key={i} style={{height:`${h}%`}}></i>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <main className="main">
      <div className="page-header">
        <span className="page-title">技能管理</span>
        <button className="btn primary">+ 手动创建</button>
      </div>
      <div className="content">
        <div className="group-title">进化生成（运行轨迹自动沉淀）</div>
        <div className="skill-grid">
          {evolvedSkills.map((skill, idx) => renderSkillCard(skill, idx))}
        </div>

        <div className="group-title">手动创建</div>
        <div className="skill-grid">
          {manualSkills.map((skill, idx) => renderSkillCard(skill, idx))}
        </div>

        <div className="group-title">市场安装</div>
        <div className="skill-grid">
          {marketSkills.map((skill, idx) => renderSkillCard(skill, idx))}
        </div>
      </div>
    </main>
  )
}
