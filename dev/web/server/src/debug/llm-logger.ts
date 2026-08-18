import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { resolve } from 'path'
import { getDataDir } from '../config.js'

const DEBUG_DIR = () => resolve(getDataDir(), 'debug')

function systemPromptFingerprint(messages: unknown[]): string {
  const sysMsg = (messages || []).find(m => (m as any)?.role === 'system')
  if (!sysMsg || typeof (sysMsg as any).content !== 'string') return ''
  const content = (sysMsg as any).content
  // Only hash first 500 chars — enough to detect agent/tool changes
  return createHash('sha256').update(content.slice(0, 500)).digest('hex').slice(0, 12)
}

// ── Per-session FIFO write queue ──
// logLLMCall used to rewrite the whole merged_N.json synchronously on every LLM
// call. With large sessions that file is multi-MB, so the read-modify-write
// cycle blocked the Node event loop long enough to stall socket.io heartbeats
// (client ping-timeout disconnects mid-run). Writes are now async and
// serialized per session, so the event loop stays responsive and concurrent
// turns can never race on the same file. The on-disk format is unchanged.
const queues = new Map<string, Promise<void>>()

function enqueue(sessionId: string, task: () => Promise<void>): void {
  const prev = queues.get(sessionId) || Promise.resolve()
  const next = prev
    .then(task)
    .catch(() => { /* debug logging is best-effort: never throw into the run loop */ })
  // Keep the chain alive for the next turn; settled chains drop out and GC.
  queues.set(sessionId, next.then(() => undefined).catch(() => undefined))
}

export function logLLMCall(
  sessionId: string | undefined,
  turn: number,
  request: { model: string; messages: unknown[]; tools?: unknown[] },
  response: { text: string; reasoning: string; toolCalls: unknown[]; usage: { input: number; output: number } | null },
  error?: string,
) {
  const id = sessionId || 'unknown'
  const ts = Date.now()
  const fp = systemPromptFingerprint(request.messages)
  const newTurn = { request, response, error, timestamp: ts, turn, fp }

  enqueue(id, async () => {
    const dir = resolve(DEBUG_DIR(), id)
    await mkdir(dir, { recursive: true })

    let mergedFiles: string[]
    try {
      mergedFiles = (await readdir(dir))
        .filter(f => f.startsWith('merged_') && f.endsWith('.json'))
        .sort()
    } catch {
      mergedFiles = []
    }

    if (mergedFiles.length === 0) {
      await writeFile(resolve(dir, 'merged_1.json'), JSON.stringify({ turns: [newTurn] }, null, 2), 'utf-8')
      return
    }

    const lastFile = mergedFiles[mergedFiles.length - 1]
    let data: { turns?: Array<{ fp?: string }> }
    try {
      data = JSON.parse(await readFile(resolve(dir, lastFile), 'utf-8')) as { turns?: Array<{ fp?: string }> }
    } catch {
      // Corrupt/partial tail (e.g. a previous crash mid-write): start a fresh
      // merged file instead of losing this turn or throwing into the run loop.
      const groupNum = mergedFiles.length + 1
      await writeFile(resolve(dir, `merged_${groupNum}.json`), JSON.stringify({ turns: [newTurn] }, null, 2), 'utf-8')
      return
    }

    const lastTurn = data.turns?.[data.turns.length - 1]
    if (lastTurn && lastTurn.fp && lastTurn.fp !== fp) {
      // System prompt fingerprint changed (agent/tools/skills modified): split.
      const groupNum = mergedFiles.length + 1
      await writeFile(resolve(dir, `merged_${groupNum}.json`), JSON.stringify({ turns: [newTurn] }, null, 2), 'utf-8')
    } else {
      data.turns = data.turns || []
      data.turns.push(newTurn as never)
      await writeFile(resolve(dir, lastFile), JSON.stringify(data, null, 2), 'utf-8')
    }
  })
}
