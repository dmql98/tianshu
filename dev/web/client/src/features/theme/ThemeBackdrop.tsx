/**
 * 主题背景层（TIANSHU_THEME_SWITCHING_PLAN §4.3）。
 *
 * - 独立组件统一渲染背景图，不在各页面重复设置。
 * - pointer-events: none + aria-hidden="true"，不拦截交互。
 * - `strength` 控制背景存在感：home 允许较明显；task（会话/设置/编辑等）降低。
 * - 背景参数（图片/焦点/透明度/暗化）由 themeRuntime 写入
 *   `--theme-backdrop-*` 注册变量，本组件只消费。
 */
export default function ThemeBackdrop({ strength = 'task' }: { strength?: 'home' | 'task' }) {
  return <div className="theme-backdrop" data-strength={strength} aria-hidden="true" />
}
