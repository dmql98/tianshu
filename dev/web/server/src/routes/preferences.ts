/**
 * 用户偏好 API（USER_PREFERENCES_PLAN）。
 *
 * GET /api/user-preferences
 * PUT /api/user-preferences   （body 局部更新：`theme` / `iconPack` 存在即替换，null 清除）
 *
 * 持久层：<dataDir>/user-preferences.json（随机端口重启场景下主题/图标偏好仍保留）。
 */
import { Hono } from 'hono'
import { readUserPreferences, setUserPreferences } from '../preferences/store.js'

const router = new Hono()

router.get('/', (c) => c.json(readUserPreferences()))

router.put('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: '请求体必须是 JSON 对象' }, 400)
  }
  const updated = setUserPreferences(body)
  return c.json(updated)
})

export default router