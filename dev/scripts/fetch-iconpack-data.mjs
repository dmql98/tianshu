/**
 * 图标包数据生成脚本。
 *
 * 统一模型：内置包与用户包同构（pack.json + assets/*.svg），差异仅在根目录：
 *   - 内置只读层 content/builtin/iconpacks/<id>/（本脚本直接写 SVG 资产 + pack.json）
 *   - 用户层 <dataDir>/iconpacks/<id>/（line-md 示例包落在这里）
 *
 * 1. streamline-freehand（内置）：下载 43 槽位 SVG → content/builtin/iconpacks/streamline-freehand/
 * 2. line-md（模拟用户本地创建的包）：下载 43 个 SVG → <dataDir>/iconpacks/custom-line-md/
 *
 * 用法：node scripts/fetch-iconpack-data.mjs
 */
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const BUILTIN_STREAMLINE_DIR = join(REPO_ROOT, 'content', 'builtin', 'iconpacks', 'streamline-freehand')
const DATA_DIR = 'C:\\.Tianshu-b'
const LINE_MD_PACK_DIR = join(DATA_DIR, 'iconpacks', 'custom-line-md')

/** 43 槽位 → streamline-freehand 图标名。 */
const SLOT_TO_STREAMLINE = {
  'nav-chat': 'conversation-chat',
  'nav-characters': 'face-id-user',
  'nav-skills': 'creativity-idea-bulb',
  'nav-tools': 'settings-hammer',
  'nav-mcp': 'network-connector',
  'nav-knowledge': 'book-bookmark',
  'nav-market': 'e-commerce-online-shop',
  'nav-events': 'calendar-grid',
  'nav-settings': 'settings-cog',
  'tool-read': 'form-edition-clipboard',
  'tool-write': 'edit-pen-write-paper',
  'tool-edit': 'edit-pencil',
  'tool-bash': 'terminal',
  'tool-grep': 'search-magnifier',
  'tool-glob': 'organization-files',
  'attach': 'form-edition-file-attach',
  'image': 'camera',
  'send': 'send-email-paper-plane-1',
  'folder': 'office-folder',
  'folder-open': 'archive-drawer-1',
  'rename': 'task-list-pen',
  'copy': 'copy-paste-clipboard',
  'export': 'download-brackets',
  'delete': 'delete-bin-2',
  'close': 'remove-delete-sign-bold',
  'more': 'menu-navigation-horizontal',
  'success': 'form-validation-check-square-1',
  'error': 'delete-disable-block-1',
  'warning': 'alerts-warning-triangle',
  'waiting': 'time-stopwatch',
  'running': 'loading-spinning-star',
  'archived': 'archive-box',
  'question': 'help-question-circle',
  'goal': 'select-target-crosshair-1',
  'menu': 'menu-navigation-2',
  'pin': 'task-list-pin-1',
  'add': 'add-sign-bold',
  'home': 'home',
  'preview': 'view-eye-1',
  'info': 'information-desk',
  'palette': 'color-palette',
  'package': 'module-building-blocks',
  'file': 'office-file-text',
}

/** 43 槽位 → line-md 图标名。 */
const SLOT_TO_LINE_MD = {
  'nav-chat': 'chat',
  'nav-characters': 'person',
  'nav-skills': 'lightbulb',
  'nav-tools': 'computer',
  'nav-mcp': 'link',
  'nav-knowledge': 'document',
  'nav-market': 'star',
  'nav-events': 'calendar',
  'nav-settings': 'cog',
  'tool-read': 'file-search',
  'tool-write': 'pencil',
  'tool-edit': 'edit',
  'tool-bash': 'monitor',
  'tool-grep': 'search',
  'tool-glob': 'folder-multiple',
  'attach': 'upload',
  'image': 'image',
  'send': 'email',
  'folder': 'folder',
  'folder-open': 'folder-arrow-right',
  'rename': 'marker',
  'copy': 'clipboard',
  'export': 'file-export',
  'delete': 'trash',
  'close': 'close',
  'more': 'list-3',
  'success': 'confirm-circle',
  'error': 'close-circle',
  'warning': 'alert-circle',
  'waiting': 'watch',
  'running': 'play',
  'archived': 'backup-restore',
  'question': 'question-circle',
  'goal': 'my-location',
  'menu': 'menu',
  'pin': 'map-marker',
  'add': 'plus',
  'home': 'home',
  'preview': 'external-link',
  'info': 'at',
  'palette': 'paint-drop',
  'package': 'grid-3',
  'file': 'file',
}

async function downloadPack(slotMap, assetsDir, prefix) {
  mkdirSync(assetsDir, { recursive: true })
  const slots = {}
  for (const [slot, name] of Object.entries(slotMap)) {
    const url = `https://api.iconify.design/${prefix}/${name}.svg`
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.warn(`[${prefix}] 下载失败 ${name} (slot ${slot}): ${res.status}`)
        continue
      }
      const svg = await res.text()
      const file = `${slot}.svg`
      writeFileSync(join(assetsDir, file), svg, 'utf-8')
      slots[slot] = { file, tint: true }
    } catch (err) {
      console.warn(`[${prefix}] 下载异常 ${name} (slot ${slot}): ${err?.message ?? err}`)
    }
  }
  return slots
}

function writePack(dir, id, name, slots) {
  const now = new Date().toISOString()
  const pack = {
    schemaVersion: 1,
    id,
    name,
    slots,
    createdAt: now,
    updatedAt: now,
  }
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n', 'utf-8')
  return Object.keys(slots).length
}

async function main() {
  console.log('1/2 下载 streamline-freehand 内置包 → content/builtin/iconpacks/streamline-freehand/')
  rmSync(BUILTIN_STREAMLINE_DIR, { recursive: true, force: true })
  const streamlineSlots = await downloadPack(SLOT_TO_STREAMLINE, join(BUILTIN_STREAMLINE_DIR, 'assets'), 'streamline-freehand')
  writePack(BUILTIN_STREAMLINE_DIR, 'streamline-freehand', 'Streamline Freehand', streamlineSlots)
  console.log(`    → ${BUILTIN_STREAMLINE_DIR}（${Object.keys(streamlineSlots).length} 枚）`)

  console.log('2/2 下载 line-md 示例包到 dataDir…')
  rmSync(LINE_MD_PACK_DIR, { recursive: true, force: true })
  const lineMdSlots = await downloadPack(SLOT_TO_LINE_MD, join(LINE_MD_PACK_DIR, 'assets'), 'line-md')
  writePack(LINE_MD_PACK_DIR, 'custom-line-md', 'Line MD 手绘包', lineMdSlots)
  console.log(`    → ${LINE_MD_PACK_DIR}（${Object.keys(lineMdSlots).length} 枚）`)
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exit(1)
})