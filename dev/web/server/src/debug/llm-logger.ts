import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { resolve } from 'path'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../data')
const DEBUG_DIR = resolve(DATA_DIR, 'debug')

function systemPromptFingerprint(messages: unknown[]): string {
  const sysMsg = (messages || []).find(m => (m as any)?.role === 'system')
  if (!sysMsg || typeof (sysMsg as any).content !== 'string') return ''
  const content = (sysMsg as any).content
  // Only hash first 500 chars — enough to detect agent/tool changes
  return createHash('sha256').update(content.slice(0, 500)).digest('hex').slice(0, 12)
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
  const dir = resolve(DEBUG_DIR, id)
  mkdirSync(dir, { recursive: true })

  const fp = systemPromptFingerprint(request.messages)
  const newTurn = { request, response, error, timestamp: ts, turn, fp }

  let mergedFiles: string[]
  try {
    mergedFiles = readdirSync(dir)
      .filter(f => f.startsWith('merged_') && f.endsWith('.json'))
      .sort()
  } catch {
    mergedFiles = []
  }

  if (mergedFiles.length > 0) {
    const lastFile = mergedFiles[mergedFiles.length - 1]
    const raw = readFileSync(resolve(dir, lastFile), 'utf-8')
    const data = JSON.parse(raw)
    const lastTurn = data.turns?.[data.turns.length - 1]

    // Split if system prompt fingerprint changed (agent/tools/skills modified)
    if (lastTurn && lastTurn.fp && lastTurn.fp !== fp) {
      const groupNum = mergedFiles.length + 1
      writeFileSync(
        resolve(dir, `merged_${groupNum}.json`),
        JSON.stringify({ turns: [newTurn] }, null, 2),
        'utf-8',
      )
    } else {
      data.turns.push(newTurn)
      writeFileSync(resolve(dir, lastFile), JSON.stringify(data, null, 2), 'utf-8')
    }
  } else {
    writeFileSync(
      resolve(dir, 'merged_1.json'),
      JSON.stringify({ turns: [newTurn] }, null, 2),
      'utf-8',
    )
  }
}
