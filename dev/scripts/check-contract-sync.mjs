#!/usr/bin/env node
/**
 * scripts/check-contract-sync.mjs — 校验桌面端 contracts-sync 副本与 cloud-server 权威契约一致。
 *
 * 契约唯一权威：C:\Users\dmql\Desktop\腾讯云\腾讯云\cloud-server\src\contracts\*.ts
 * 桌面端副本：desktop/src/cloud/contracts-sync/*.ts
 * 漂移（hash 不一致）时退出码 1，并把权威文件复制到副本（--fix 模式下）。
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** 契约权威路径（用户目录，跨盘绝对路径）。 */
const AUTHORITATIVE = 'C:\\Users\\dmql\\Desktop\\腾讯云\\腾讯云\\cloud-server\\src\\contracts'
const COPY = join(DEV_ROOT, 'desktop', 'src', 'cloud', 'contracts-sync')

const FILES = ['sync-contract.ts', 'cloud-api.ts', 'sync-scope.ts']

const fix = process.argv.includes('--fix')
let drift = false

for (const file of FILES) {
  const authPath = join(AUTHORITATIVE, file)
  const copyPath = join(COPY, file)
  if (!existsSync(authPath)) {
    console.error(`✗ authoritative missing: ${authPath}`)
    drift = true
    continue
  }
  const authHash = createHash('sha256').update(readFileSync(authPath)).digest('hex').slice(0, 16)
  if (!existsSync(copyPath)) {
    console.error(`✗ copy missing: ${copyPath}`)
    if (fix) {
      writeFileSync(copyPath, readFileSync(authPath))
      console.error(`  → copied (--fix)`)
    }
    drift = true
    continue
  }
  const copyHash = createHash('sha256').update(readFileSync(copyPath)).digest('hex').slice(0, 16)
  if (authHash !== copyHash) {
    console.error(`✗ drift: ${file}  authoritative=${authHash} copy=${copyHash}`)
    if (fix) {
      writeFileSync(copyPath, readFileSync(authPath))
      console.error(`  → overwritten (--fix)`)
    }
    drift = true
  } else {
    console.log(`✓ ${file} ${authHash}`)
  }
}

if (drift) {
  console.error('\ncontract drift detected. run: node scripts/check-contract-sync.mjs --fix')
  process.exit(1)
}
console.log('\ncontracts in sync.')
