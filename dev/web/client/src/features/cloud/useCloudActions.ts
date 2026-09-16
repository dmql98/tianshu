import { useState } from 'react'
import { useI18n } from '@/i18n'
import type { CloudActionResult } from '../../../../../shared/desktop-contract.js'

/**
 * useCloudActions — 三处六按钮的动作封装（云同步全手动）。
 * 每个 hook 返回 [busy, run]；run 弹出确认/结果用轻量 message 状态呈现。
 */

type Runner = () => Promise<CloudActionResult>

function useAction(): { busy: boolean; message: string | null; run: (fn: Runner, successPrefix: string) => Promise<void>; clear: () => void } {
  const t = useI18n()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const run = async (fn: Runner, successPrefix: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await fn()
      if (r.ok) {
        const parts: string[] = []
        if (r.uploaded != null && r.uploaded > 0) parts.push(`${t('上传')} ${r.uploaded} ${t('个文件')}`)
        if (r.downloaded != null && r.downloaded > 0) parts.push(`${t('下载')} ${r.downloaded} ${t('个文件')}`)
        if (r.removed != null && r.removed > 0) parts.push(`${t('清理')} ${r.removed}`)
        if (r.backedUp != null && r.backedUp > 0) parts.push(`${t('已备份')} ${r.backedUp} ${t('个文件到 .sync-backup')}`)
        setMessage(`${successPrefix}${parts.length ? '：' + parts.join('，') : ''}`)
      } else {
        setMessage(r.error ?? t('操作失败'))
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, run, clear: () => setMessage(null) }
}

export function useCloudCharacterActions(characterId: string) {
  const api = window.tianshuDesktop
  const t = useI18n()
  const up = useAction()
  const pull = useAction()
  return {
    available: Boolean(api),
    upBusy: up.busy,
    pullBusy: pull.busy,
    upMessage: up.message,
    pullMessage: pull.message,
    push: () => api && up.run(() => api.cloudPushCharacter(characterId), t('已同步到云端')),
    pullAll: () => api && pull.run(() => api.cloudPullCharacters(), t('已拉取云端角色')),
    clear: () => { up.clear(); pull.clear() },
  }
}

/** SkillView：页头「拉取云端技能」+ 卡片「同步到云端」（push 直接走 api，返回错误信息）。 */
export function useCloudSkillActions() {
  const api = window.tianshuDesktop
  const t = useI18n()
  const pull = useAction()
  return {
    available: Boolean(api),
    pullBusy: pull.busy,
    pullMessage: pull.message,
    pullAll: () => api && pull.run(() => api.cloudPullSkills(), t('已拉取云端技能')),
    pushSkill: async (category: string, pkgId: string): Promise<CloudActionResult> => {
      if (!api) return { ok: false, error: t('仅桌面客户端支持云同步') }
      return api.cloudPushSkill(category, pkgId)
    },
  }
}

export function useCloudConfigActions() {
  const api = window.tianshuDesktop
  const t = useI18n()
  const up = useAction()
  const pull = useAction()
  return {
    available: Boolean(api),
    upBusy: up.busy,
    pullBusy: pull.busy,
    upMessage: up.message,
    pullMessage: pull.message,
    push: () => api && up.run(() => api.cloudPushConfig(), t('配置已上传到云端')),
    pull: () => api && pull.run(() => api.cloudPullConfig(), t('配置已从云端下载')),
    clear: () => { up.clear(); pull.clear() },
  }
}
