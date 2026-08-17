/**
 * runtime-paths.test.ts — 内置 Node 路径解析与 manifest 校验（迁移指南 §12.1）。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bundledNodePath,
  readRuntimeManifest,
  runtimeManifestPath,
  verifyBundledNode,
} from '../src/runtime-paths.js'

const dirs: string[] = []

function tempResources(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tianshu-runtime-paths-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('bundledNodePath', () => {
  it('win32 解析到 runtime/node/node.exe', () => {
    // platform 参数决定可执行文件布局，分隔符仍由当前测试宿主决定；
    // CI 的 validate 运行在 Linux，不能把 Windows 分隔符硬编码进断言。
    expect(bundledNodePath('C:\\res', 'win32')).toBe(join('C:\\res', 'runtime', 'node', 'node.exe'))
  })

  it('darwin/linux 解析到 runtime/node/bin/node', () => {
    expect(bundledNodePath('/res', 'darwin')).toBe(join('/res', 'runtime', 'node', 'bin', 'node'))
    expect(bundledNodePath('/res', 'linux')).toBe(join('/res', 'runtime', 'node', 'bin', 'node'))
  })

  it('默认使用当前进程平台', () => {
    const p = bundledNodePath('/res')
    expect(p.endsWith(process.platform === 'win32' ? 'node.exe' : 'bin/node')).toBe(true)
  })
})

describe('readRuntimeManifest', () => {
  it('读取有效 manifest', () => {
    const res = tempResources()
    mkdirSync(join(res, 'runtime'), { recursive: true })
    writeFileSync(
      join(res, 'runtime', 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        nodeVersion: '24.19.0',
        platform: 'darwin',
        arch: 'arm64',
        archive: 'node-v24.19.0-darwin-arm64.tar.gz',
        sha256: 'abc',
      }),
      'utf8',
    )
    const manifest = readRuntimeManifest(res)
    expect(manifest?.platform).toBe('darwin')
    expect(manifest?.arch).toBe('arm64')
    expect(runtimeManifestPath(res)).toBe(join(res, 'runtime', 'runtime-manifest.json'))
  })

  it('缺失或无效时返回 null', () => {
    expect(readRuntimeManifest(tempResources())).toBeNull()
    const res = tempResources()
    mkdirSync(join(res, 'runtime'), { recursive: true })
    writeFileSync(join(res, 'runtime', 'runtime-manifest.json'), '{bad json', 'utf8')
    expect(readRuntimeManifest(res)).toBeNull()
    writeFileSync(join(res, 'runtime', 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8')
    expect(readRuntimeManifest(res)).toBeNull()
  })
})

describe('verifyBundledNode', () => {
  it('Node 文件缺失时给出可读错误而不是 ENOENT', () => {
    const res = tempResources()
    const result = verifyBundledNode(res, 'win32', 'x64')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('内置 Node 不存在')
  })

  it('manifest 缺失时给出可读错误', () => {
    const res = tempResources()
    mkdirSync(join(res, 'runtime', 'node'), { recursive: true })
    writeFileSync(join(res, 'runtime', 'node', 'node.exe'), 'x', 'utf8')
    const result = verifyBundledNode(res, 'win32', 'x64')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('runtime-manifest.json')
  })

  it('manifest 平台/架构不匹配时拒绝（防止把上一平台 runtime 打进下一平台包，§8.4）', () => {
    const res = tempResources()
    mkdirSync(join(res, 'runtime', 'node'), { recursive: true })
    writeFileSync(join(res, 'runtime', 'node', 'node.exe'), 'x', 'utf8')
    writeFileSync(
      join(res, 'runtime', 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        nodeVersion: '24.19.0',
        platform: 'darwin',
        arch: 'arm64',
        archive: 'node-v24.19.0-darwin-arm64.tar.gz',
        sha256: 'abc',
      }),
      'utf8',
    )
    const result = verifyBundledNode(res, 'win32', 'x64')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('平台/架构不匹配')
  })

  it('文件存在且 manifest 匹配时通过', () => {
    const res = tempResources()
    mkdirSync(join(res, 'runtime', 'node'), { recursive: true })
    writeFileSync(join(res, 'runtime', 'node', 'node.exe'), 'x', 'utf8')
    writeFileSync(
      join(res, 'runtime', 'runtime-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        nodeVersion: '24.19.0',
        platform: 'win32',
        arch: 'x64',
        archive: 'node-v24.19.0-win-x64.zip',
        sha256: 'abc',
      }),
      'utf8',
    )
    expect(verifyBundledNode(res, 'win32', 'x64')).toEqual({ ok: true })
  })
})
