/**
 * 图标语义槽位清单（ICON_PACK_PLAN §2）。
 *
 * 设计原则（与主题系统同构）：
 * - 组件只消费「语义槽位 key」（如 nav-chat），不感知具体图标包。
 * - 槽位清单由系统固定维护（可扩展，但已发布的 key 不重命名、不删除，只增）。
 * - 图标包 = 「槽位 key → 图形数据」的映射表；换包 = 换映射，组件零改动。
 */
export const ICON_SLOT_GROUPS = [
  '导航栏',
  '聊天操作',
  '文件与会话',
  '状态与反馈',
  '界面与入口',
] as const

export type IconSlotGroup = (typeof ICON_SLOT_GROUPS)[number]

export interface IconSlot {
  /** 语义 key，组件侧唯一引用（snake-case）。 */
  key: string
  /** 展示名（中文，i18n key 即中文原文）。 */
  name: string
  group: IconSlotGroup
}

/**
 * 槽位清单（v1，41 枚）。
 * 命名规则：<域>-<含义>；导航/状态类用短前缀（nav- / st- 之外的组直接含义词）。
 */
export const ICON_SLOTS: readonly IconSlot[] = [
  // ── 导航栏 ──
  { key: 'nav-chat', name: '会话', group: '导航栏' },
  { key: 'nav-characters', name: '角色', group: '导航栏' },
  { key: 'nav-skills', name: '技能', group: '导航栏' },
  { key: 'nav-tools', name: '工具', group: '导航栏' },
  { key: 'nav-mcp', name: 'MCP', group: '导航栏' },
  { key: 'nav-knowledge', name: '知识', group: '导航栏' },
  { key: 'nav-market', name: '市场', group: '导航栏' },
  { key: 'nav-stats', name: '统计', group: '导航栏' },
  { key: 'nav-events', name: '事件', group: '导航栏' },
  { key: 'nav-settings', name: '设置', group: '导航栏' },

  // ── 聊天操作 ──
  { key: 'tool-read', name: '读取文件', group: '聊天操作' },
  { key: 'tool-write', name: '写入文件', group: '聊天操作' },
  { key: 'tool-edit', name: '编辑', group: '聊天操作' },
  { key: 'tool-bash', name: '终端', group: '聊天操作' },
  { key: 'tool-grep', name: '搜索', group: '聊天操作' },
  { key: 'tool-glob', name: '浏览文件', group: '聊天操作' },
  { key: 'attach', name: '附件', group: '聊天操作' },
  { key: 'image', name: '图片', group: '聊天操作' },
  { key: 'send', name: '发送', group: '聊天操作' },

  // ── 文件与会话 ──
  { key: 'folder', name: '文件夹', group: '文件与会话' },
  { key: 'folder-open', name: '打开文件夹', group: '文件与会话' },
  { key: 'rename', name: '重命名', group: '文件与会话' },
  { key: 'copy', name: '复制', group: '文件与会话' },
  { key: 'export', name: '导出', group: '文件与会话' },
  { key: 'delete', name: '删除', group: '文件与会话' },
  { key: 'close', name: '关闭', group: '文件与会话' },
  { key: 'more', name: '更多', group: '文件与会话' },

  // ── 状态与反馈 ──
  { key: 'success', name: '成功', group: '状态与反馈' },
  { key: 'error', name: '失败', group: '状态与反馈' },
  { key: 'warning', name: '警告', group: '状态与反馈' },
  { key: 'waiting', name: '等待', group: '状态与反馈' },
  { key: 'running', name: '运行中', group: '状态与反馈' },
  { key: 'archived', name: '归档', group: '状态与反馈' },
  { key: 'question', name: '询问', group: '状态与反馈' },
  { key: 'goal', name: '目标', group: '状态与反馈' },

  // ── 界面与入口 ──
  { key: 'menu', name: '菜单', group: '界面与入口' },
  { key: 'pin', name: '置顶', group: '界面与入口' },
  { key: 'add', name: '添加', group: '界面与入口' },
  { key: 'search', name: '搜索', group: '界面与入口' },
  { key: 'home', name: '首页', group: '界面与入口' },
  { key: 'preview', name: '预览', group: '界面与入口' },
  { key: 'info', name: '信息', group: '界面与入口' },
  { key: 'palette', name: '外观', group: '界面与入口' },
  { key: 'package', name: '技能包', group: '界面与入口' },
  { key: 'file', name: '文件', group: '界面与入口' },
]

/** 槽位 key 快速集合（校验/去重用）。 */
export const ICON_SLOT_KEYS: ReadonlySet<string> = new Set(ICON_SLOTS.map(s => s.key))

/** 是否合法槽位 key。 */
export function isIconSlotKey(value: unknown): value is string {
  return typeof value === 'string' && ICON_SLOT_KEYS.has(value)
}

/** 按 key 查找槽位；未找到返回 null。 */
export function findIconSlot(key: string): IconSlot | null {
  return ICON_SLOTS.find(s => s.key === key) ?? null
}

/** 分组视图：group → slots（保持 ICON_SLOTS 声明顺序）。 */
export function iconSlotsByGroup(): Record<IconSlotGroup, IconSlot[]> {
  const result: Record<IconSlotGroup, IconSlot[]> = {
    '导航栏': [],
    '聊天操作': [],
    '文件与会话': [],
    '状态与反馈': [],
    '界面与入口': [],
  }
  for (const slot of ICON_SLOTS) result[slot.group].push(slot)
  return result
}
