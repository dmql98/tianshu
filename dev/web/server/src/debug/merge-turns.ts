import { readdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, statSync } from 'fs'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const DEBUG_DIR = resolve(DATA_DIR, 'debug')
const DAY_MS = 86400000

export function mergeOldDebugTurns(force = false) {
  let entries: string[]
  try {
    entries = readdirSync(DEBUG_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return
  }

  const cutoff = Date.now() - 86400000

  for (const sessionId of entries) {
    const dir = resolve(DEBUG_DIR, sessionId)
    const files = readdirSync(dir).filter(f => f.includes('_turn'))

    if (files.some(f => f.startsWith('merged_'))) continue

    const timestamps = files.map(f => {
      const m = f.match(/^(\d+)_turn\d+\.json$/)
      return m ? Number(m[1]) : 0
    }).filter(t => t > 0)

    if (timestamps.length === 0) continue
    if (!force && Math.max(...timestamps) > cutoff) continue

    files.sort()
    const groups: string[][] = []
    let current: string[] = []
    let prevTurn = 0

    for (const f of files) {
      const m = f.match(/_turn(\d+)\.json$/)
      const turnNum = m ? Number(m[1]) : 0
      if (turnNum <= prevTurn && current.length > 0) {
        groups.push(current)
        current = []
      }
      current.push(f)
      prevTurn = turnNum
    }
    if (current.length > 0) groups.push(current)

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      const turns = group.map(f => {
        const raw = readFileSync(resolve(dir, f), 'utf-8')
        return JSON.parse(raw)
      })
      const mergedFile = resolve(dir, `merged_${i + 1}.json`)
      writeFileSync(mergedFile, JSON.stringify({ turns }, null, 2), 'utf-8')
      for (const f of group) {
        unlinkSync(resolve(dir, f))
      }
    }

    console.log(`[merge-turns] Merged ${sessionId}: ${groups.length} groups from ${files.length} turns`)
  }
}

export function deleteOldDebugSessions() {
  let entries: string[]
  try {
    entries = readdirSync(DEBUG_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return
  }

  const cutoff = Date.now() - 25 * DAY_MS

  for (const sessionId of entries) {
    const dir = resolve(DEBUG_DIR, sessionId)
    try {
      const st = statSync(dir)
      if (st.birthtimeMs > 0 && st.birthtimeMs < cutoff) {
        rmSync(dir, { recursive: true, force: true })
        console.log(`[merge-turns] Deleted old session ${sessionId}`)
      }
    } catch {
      // folder might have been deleted already
    }
  }
}
