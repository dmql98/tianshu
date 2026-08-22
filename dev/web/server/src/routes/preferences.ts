/**
 * 轻量偏好路由（USER_PREFERENCES_PLAN 重构：按职责拆分）。
 *
 * 挂载点：/api/preferences
 * - GET  /theme           读取主题选择（config/theme.json）
 * - PUT  /theme           保存主题选择
 * - GET  /iconpack        读取图标包选择（config/iconpack.json）
 * - PUT  /iconpack        保存图标包选择
 * - GET  /model-usage     读取常用模型计数（config/model-usage.json）
 * - PUT  /model-usage     保存常用模型计数
 *
 * 持久层：<dataDir>/config/{theme.json, iconpack.json, model-usage.json}
 * （随机端口重启场景下仍保留，因为落盘到磁盘而非 localStorage）。
 */
import { Hono } from 'hono'
import { getThemeSelection, saveThemeSelection } from '../preferences/themeStore.js'
import { getIconPackSelection, saveIconPackSelection } from '../preferences/iconPackStore.js'
import { getModelUsage, saveModelUsage, normalizeModelUsage } from '../preferences/modelUsageStore.js'
import { normalizeThemeSelection, normalizeIconPackSelection } from '../preferences/validation.js'

const router = new Hono()

// ── 主题选择 ──
router.get('/theme', (c) => c.json(getThemeSelection() ?? { mode: 'system' }))
router.put('/theme', async (c) => {
  const body = await c.req.json().catch(() => null)
  const sel = normalizeThemeSelection(body)
  if (!sel) return c.json({ error: '非法的主题选择' }, 400)
  saveThemeSelection(sel)
  return c.json(sel)
})

// ── 图标包选择 ──
router.get('/iconpack', (c) => c.json(getIconPackSelection() ?? { packId: 'lucide' }))
router.put('/iconpack', async (c) => {
  const body = await c.req.json().catch(() => null)
  const pack = normalizeIconPackSelection(body)
  if (!pack) return c.json({ error: '非法的图标包选择' }, 400)
  saveIconPackSelection(pack)
  return c.json(pack)
})

// ── 常用模型计数 ──
router.get('/model-usage', (c) => c.json(getModelUsage()))
router.put('/model-usage', async (c) => {
  const body = await c.req.json().catch(() => null)
  const usage = normalizeModelUsage(body)
  saveModelUsage(usage)
  return c.json(usage)
})

export default router
