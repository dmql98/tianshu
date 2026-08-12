import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

/**
 * 将 src/provider-catalog/** 复制到 dist/provider-catalog/**。
 * tsc 只编译 .ts，provider.json 与 icon.svg 等资产需要显式复制，
 * 以保证生产 / Electron 打包环境下 catalog 扫描可用。
 */
const __dirname = dirname(fileURLToPath(import.meta.url))
const src = join(__dirname, '..', 'src', 'provider-catalog')
const dest = join(__dirname, '..', 'dist', 'provider-catalog')

if (!existsSync(src)) {
  console.error('[copy-provider-catalog] src/provider-catalog 不存在，跳过')
  process.exit(0)
}

let copied = 0
const copyAsset = (p) => {
  const rel = p.slice(src.length)
  const out = join(dest, rel)
  mkdirSync(dirname(out), { recursive: true })
  cpSync(p, out)
  copied++
}
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      walk(p)
    } else if (entry === 'provider.json' || entry.endsWith('.svg')) {
      copyAsset(p)
    }
  }
}
// 许可证与文档随资产一起分发，满足 MIT 许可证保留要求。
for (const doc of ['LICENSE', 'LICENSES.md', 'README.md']) {
  const docPath = join(src, doc)
  if (existsSync(docPath)) copyAsset(docPath)
}
walk(src)
console.log(`[copy-provider-catalog] copied ${copied} asset files to dist/provider-catalog`)
