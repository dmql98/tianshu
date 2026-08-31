import { memo, useEffect, useState } from 'react'

interface Props {
  /** 起算时间戳（毫秒，Date.now 语义）。缺省时显示脉冲省略号。 */
  sinceMs?: number
  /** 已结算的基准时长（毫秒），叠加在 live 段之上（如参数生成段已耗时）。 */
  offsetMs?: number
  /** 显示样式扩展类。 */
  className?: string
}

function liveText(totalMs: number): string {
  const s = Math.max(0, Math.floor(totalMs / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${s % 60}s`
}

/**
 * 进行中工具的秒级 live 计时（对齐 penguin-harness live-duration）：每秒 tick 一次，只
 * 显示整秒；起算时间戳缺失时退化为脉冲省略号。
 */
export default memo(function LiveDuration({ sinceMs, offsetMs = 0, className = '' }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (sinceMs === undefined) return <span className="animate-pulse">…</span>
  return <span className={className}>{liveText(offsetMs + Math.max(0, now - sinceMs))}</span>
})
