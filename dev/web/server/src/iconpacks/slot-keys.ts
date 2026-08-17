/**
 * 图标包槽位 key 清单（服务端副本）。
 *
 * ⚠️ 唯一事实来源是客户端 `web/client/src/features/icons/iconSlots.ts`；
 * 本文件由构建/审查流程手工同步（服务端不得 import 客户端代码）。
 * 新增槽位时两端必须同时更新，否则服务端会拒绝新槽位的上传。
 */
export const ICON_SLOT_KEYS: ReadonlySet<string> = new Set([
  // 导航栏
  'nav-chat',
  'nav-characters',
  'nav-skills',
  'nav-tools',
  'nav-mcp',
  'nav-knowledge',
  'nav-market',
  'nav-events',
  'nav-settings',
  // 聊天操作
  'tool-read',
  'tool-write',
  'tool-edit',
  'tool-bash',
  'tool-grep',
  'tool-glob',
  'attach',
  'image',
  'send',
  // 文件与会话
  'folder',
  'folder-open',
  'rename',
  'copy',
  'export',
  'delete',
  'close',
  'more',
  // 状态与反馈
  'success',
  'error',
  'warning',
  'waiting',
  'running',
  'archived',
  'question',
  'goal',
  // 界面与入口
  'menu',
  'pin',
  'add',
  'home',
  'preview',
  'info',
  'palette',
  'package',
  'file',
])
