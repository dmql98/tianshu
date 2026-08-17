/**
 * <Icon> 语义图标渲染组件。
 *
 * 组件只消费「语义槽位 key」，不感知具体图标包：
 *   <Icon name="nav-chat" />
 *
 * 统一模型：内置包与用户包都经运行时解析为 asset URL（内置包由服务端从
 * content/builtin/iconpacks 只读层下发，用户包从 <dataDir>/iconpacks 下发），
 * 一律以 <img> 或 CSS mask+currentColor 渲染，不再内联任何 path 数据。
 *
 * - 解析到资产：tint=true 用 CSS mask + currentColor 着色（仅单色 SVG 适用），
 *   否则 <img> 原样显示。
 * - 解析不到：渲染默认占位（圆点/问号图形），不抛错、不渲染空节点。
 */
import { useSyncExternalStore } from 'react'
import { findIconSlot } from './iconSlots'
import {
  resolveIcon,
  subscribeIconRuntime,
} from './iconRuntime'

export interface IconProps {
  /** 语义槽位 key（见 iconSlots.ts）。 */
  name: string
  /** 像素尺寸（默认 16）。 */
  size?: number
  className?: string
  /** 无障碍标签；缺省用槽位名。 */
  title?: string
  /** 是否隐藏辅助技术（装饰性图标）。 */
  ariaHidden?: boolean
  /** 强调色（默认 currentColor，跟随文字/主题）。 */
  color?: string
}

const FALLBACK_PATHS = [
  // 圆形问号（任何槽位缺失时的视觉兜底）
  'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3',
  'M12 17h.01',
]

/** 订阅图标运行时：包切换/注册表刷新 → 重渲染（useSyncExternalStore 保证并发安全）。 */
function useIconRuntimeTick(): void {
  useSyncExternalStore(subscribeIconRuntime, () => 0, () => 0)
}

/** 单个资产引用的渲染（供选择器预览等按包渲染场景复用）。 */
export function IconAsset({
  url,
  tint,
  size = 16,
  className = '',
  color,
}: {
  url: string
  tint: boolean
  size?: number
  className?: string
  color?: string
}) {
  if (tint) {
    return (
      <span
        className={`icon ${className}`.trim()}
        aria-hidden="true"
        style={{
          WebkitMaskImage: `url("${url}")`,
          maskImage: `url("${url}")`,
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          backgroundColor: color ?? 'currentColor',
          width: size,
          height: size,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    />
  )
}

export default function Icon({
  name,
  size = 16,
  className = '',
  title,
  ariaHidden = true,
  color,
}: IconProps) {
  useIconRuntimeTick()
  const slot = findIconSlot(name)
  const resolved = resolveIcon(name)

  // 无障碍：装饰性图标 aria-hidden；带 title 时保留可访问名称
  const label = title ?? slot?.name ?? name
  const commonProps = {
    className: `icon icon-${name.replace(/[^a-zA-Z0-9-]/g, '-')} ${className}`.trim(),
    ...(ariaHidden ? { 'aria-hidden': true } : { role: 'img' as const, 'aria-label': label }),
    'data-icon-slot': name,
  }

  // 统一资产渲染（内置 + 用户共用）
  if (resolved?.kind === 'asset') {
    if (resolved.tint) {
      return (
        <span
          {...commonProps}
          data-tint="true"
          style={{
            WebkitMaskImage: `url("${resolved.url}")`,
            maskImage: `url("${resolved.url}")`,
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            backgroundColor: color ?? 'currentColor',
            width: size,
            height: size,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
      )
    }
    return (
      <img
        {...commonProps}
        src={resolved.url}
        alt={ariaHidden ? '' : label}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
        loading="lazy"
        onError={(event) => {
          // 资产加载失败：标记占位，避免破图（父级可监听 onError 自行处理）
          event.currentTarget.style.visibility = 'hidden'
        }}
      />
    )
  }

  // 解析不到：内联 fallback（占位图形，非包数据）
  return (
    <svg
      {...commonProps}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {FALLBACK_PATHS.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}