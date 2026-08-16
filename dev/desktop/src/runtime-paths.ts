/**
 * runtime-paths.ts — 跨平台解析内置 Node 可执行文件路径与 manifest 校验。
 *
 * 规则（迁移指南 §8.5）：
 *   win32 -> resources/runtime/node/node.exe
 *   other -> resources/runtime/node/bin/node
 *
 * 启动前验证文件存在和 runtime-manifest.json 与目标平台/架构一致，
 * 错误应进入 server.log 并通过 server status 显示可理解的信息（不能只产生 ENOENT）。
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface RuntimeManifest {
  schemaVersion: number
  nodeVersion: string
  platform: string
  arch: string
  archive: string
  sha256: string
}

/** 解析内置 Node 可执行文件绝对路径（纯函数，platform 可注入便于测试）。 */
export function bundledNodePath(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? join(resourcesPath, 'runtime', 'node', 'node.exe')
    : join(resourcesPath, 'runtime', 'node', 'bin', 'node')
}

/** runtime-manifest.json 的绝对路径。 */
export function runtimeManifestPath(resourcesPath: string): string {
  return join(resourcesPath, 'runtime', 'runtime-manifest.json')
}

/** 读取并校验 manifest；缺失或无效返回 null。 */
export function readRuntimeManifest(resourcesPath: string): RuntimeManifest | null {
  try {
    const raw = readFileSync(runtimeManifestPath(resourcesPath), 'utf8')
    const parsed = JSON.parse(raw) as RuntimeManifest
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.nodeVersion || !parsed.platform || !parsed.arch) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export interface VerifyResult {
  ok: boolean
  message?: string
}

/**
 * 启动前校验：内置 Node 文件存在 + manifest 与目标平台/架构一致。
 * 返回可理解的错误信息供 server.log / server status 展示（§8.5）。
 */
export function verifyBundledNode(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): VerifyResult {
  const nodePath = bundledNodePath(resourcesPath, platform)
  if (!existsSync(nodePath)) {
    return { ok: false, message: `内置 Node 不存在: ${nodePath}` }
  }
  const manifest = readRuntimeManifest(resourcesPath)
  if (!manifest) {
    return {
      ok: false,
      message: 'runtime-manifest.json 缺失或无效，无法确认内置 Node 与当前平台/架构一致',
    }
  }
  if (manifest.platform !== platform || manifest.arch !== arch) {
    return {
      ok: false,
      message: `runtime manifest 平台/架构不匹配（manifest: ${manifest.platform}/${manifest.arch}，当前: ${platform}/${arch}）`,
    }
  }
  return { ok: true }
}
