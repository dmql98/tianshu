import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = join(__dirname, '..', 'src', 'tools')
const dest = join(__dirname, '..', 'dist', 'tools')

for (const dir of readdirSync(src)) {
  const srcDir = join(src, dir)
  if (!statSync(srcDir).isDirectory()) continue
  const jsonSrc = join(srcDir, 'tool.json')
  if (!existsSync(jsonSrc)) continue
  const jsonDest = join(dest, dir, 'tool.json')
  mkdirSync(join(dest, dir), { recursive: true })
  copyFileSync(jsonSrc, jsonDest)
  console.log(`  tool.json → ${dir}/tool.json`)
}
