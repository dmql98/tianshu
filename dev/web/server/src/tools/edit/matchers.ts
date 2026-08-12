export interface MatchResult {
  index: number
  length: number
}

export interface ResolvedMatch {
  result: MatchResult
  method: string
  // For fuzzy matches, describe what differed so the caller can surface it
  // to the model (which otherwise wrongly assumes an exact match).
  detail?: string
}

// Normalize line endings (never changes matching semantics beyond CRLF/LF)
function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

// ---------- Level 1: Exact (the only default match) ----------
export function exactMatch(content: string, oldString: string): MatchResult | null {
  const idx = content.indexOf(oldString)
  return idx >= 0 ? { index: idx, length: oldString.length } : null
}

/** Count exact occurrences of oldString in content. */
function countExact(content: string, oldString: string): number {
  if (!oldString) return 0
  let n = 0
  let i = content.indexOf(oldString)
  while (i !== -1) { n++; i = content.indexOf(oldString, i + oldString.length) }
  return n
}

// ---------- Context-aware (multi-line, indentation-sensitive, uniqueness-checked) ----------
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[] = Array(n + 1).fill(0).map((_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
        dp[j] + 1,
        dp[j - 1] + 1,
      )
      prev = tmp
    }
  }
  return dp[n]
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

/**
 * Multi-line fuzzy match anchored on exact first/last lines, with
 * indentation kept and an 80% middle-line similarity bar. Only fires for
 * oldStrings of >= 4 lines (shorter anchors are too ambiguous) and rejects
 * when the anchored region is not unique in the file.
 */
export function contextAwareMatch(content: string, oldString: string): ResolvedMatch | null {
  const oldLines = normalizeLineEndings(oldString).split('\n')
  if (oldLines.length < 4) return null

  const firstLine = oldLines[0]
  const lastLine = oldLines[oldLines.length - 1]
  const middleLines = oldLines.slice(1, -1)
  if (middleLines.length === 0) return null

  const contentLines = normalizeLineEndings(content).split('\n')
  const candidates: Array<{ i: number; detail: string }> = []

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    // Exact anchor lines INCLUDING indentation — a dedented oldString must
    // not match a correctly-indented block.
    if (contentLines[i] !== firstLine) continue
    if (contentLines[i + oldLines.length - 1] !== lastLine) continue

    let matchCount = 0
    let diffDetail: string[] = []
    for (let j = 1; j < oldLines.length - 1; j++) {
      const a = contentLines[i + j]
      const b = middleLines[j - 1]
      if (a === b) { matchCount++; continue }
      // Indentation must match for fuzzy tolerance to apply: compare the
      // leading whitespace; if it differs, treat as a mismatch (no credit).
      const indentA = a.match(/^\s*/)![0]
      const indentB = b.match(/^\s*/)![0]
      if (indentA !== indentB) { diffDetail.push(`line ${j + 1}: indentation differs`); continue }
      if (similarity(a.trim(), b.trim()) >= 0.8) { matchCount++; continue }
      diffDetail.push(`line ${j + 1}: content differs`)
    }

    const threshold = Math.ceil(middleLines.length * 0.8)
    if (matchCount >= threshold) {
      const idx = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
      const len = contentLines.slice(i, i + oldLines.length).join('\n').length
      candidates.push({ i, detail: diffDetail.slice(0, 3).join('; ') })
    }
  }

  if (candidates.length === 0) return null
  if (candidates.length > 1) return { result: { index: 0, length: 0 }, method: 'contextAware', detail: 'match not unique in file' }

  const c = candidates[0]
  const idx = contentLines.slice(0, c.i).join('\n').length + (c.i > 0 ? 1 : 0)
  const len = contentLines.slice(c.i, c.i + oldLines.length).join('\n').length
  return {
    result: { index: idx, length: len },
    method: 'contextAware',
    detail: c.detail || 'fuzzy (indentation-preserved, 80% middle threshold)',
  }
}

// ---------- Master matcher ----------
// Order matters: exact first. Only contextAware remains as a fallback — it is
// indentation-preserving, requires >=4 lines, and enforces uniqueness, so it
// cannot silently corrupt indentation or hit an unrelated duplicate block.
export const matchers: Array<{ name: string; match: (c: string, o: string) => MatchResult | ResolvedMatch | null }> = [
  { name: 'exact', match: exactMatch },
  { name: 'contextAware', match: contextAwareMatch },
]

export function findBestMatch(content: string, oldString: string): ResolvedMatch | null {
  for (const { name, match } of matchers) {
    const result = match(content, oldString)
    if (result) {
      // Normalize a bare MatchResult into ResolvedMatch
      if ('method' in result) return result as ResolvedMatch
      return { result: result as MatchResult, method: name }
    }
  }
  return null
}
