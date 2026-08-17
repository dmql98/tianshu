/**
 * 只读内置内容路径与双层内容来源（BUILTIN_CONTENT_DEVELOPMENT_PLAN §8）。
 *
 * 内置内容路径可以因源码运行和安装包资源位置不同而不同，但用户数据路径
 * 不能因此分叉。内置路径解析顺序：
 *   1. TIANSHU_BUILTIN_CONTENT_DIR（测试 / 容器 / 高级用户显式覆盖）
 *   2. 开发模式读取仓库根目录 content/builtin
 *   3. 打包模式使用 Electron resources 中的 content/builtin
 *      （Electron 启动 server 时显式设置 TIANSHU_BUILTIN_CONTENT_DIR）
 */
import { existsSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** content/builtin 只读发行内容根。 */
export function builtinContentRoot(): string {
  const override = process.env.TIANSHU_BUILTIN_CONTENT_DIR
  if (override) return resolve(override)
  // Dev（tsx）：src/content/paths.ts → 仓库根 content/builtin。
  // 打包（tsc）：dist/content/paths.js → resourcesPath/content/builtin 由
  // ServerManager 显式设置 TIANSHU_BUILTIN_CONTENT_DIR，不依赖 cwd 推测。
  const repoRoot = resolve(__dirname, '..', '..', '..', '..')
  const candidate = resolve(repoRoot, 'content', 'builtin')
  if (existsSync(candidate)) return candidate
  return candidate
}

export function builtinCharactersRoot(): string {
  return resolve(builtinContentRoot(), 'characters')
}

export function builtinSkillsRoot(): string {
  return resolve(builtinContentRoot(), 'skills')
}

export function builtinProvidersRoot(): string {
  return resolve(builtinContentRoot(), 'providers')
}

export function builtinPromptsRoot(): string {
  return resolve(builtinContentRoot(), 'prompts')
}

export function builtinIconPacksRoot(): string {
  return resolve(builtinContentRoot(), 'iconpacks')
}

/** 内容来源：内置只读层 / 用户可写层。 */
export type ContentSource = 'builtin' | 'user'

export interface ContentOrigin {
  source: ContentSource
  readOnly: boolean
  overridesBuiltin: boolean
  /** 最终获胜来源的真实目录。 */
  root: string
}
