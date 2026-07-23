export interface MatchResult {
  index: number
  length: number
}

// Normalize line endings
function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n')
}

// ---------- Level 1: Exact ----------
export function exactMatch(content: string, oldString: string): MatchResult | null {
  const idx = content.indexOf(oldString)
  return idx >= 0 ? { index: idx, length: oldString.length } : null
}

// ---------- Level 2: Line Trimmed ----------
export function lineTrimmedMatch(content: string, oldString: string): MatchResult | null {
  const oldLines = normalizeLineEndings(oldString).split('\n').map(l => l.trim())
  const contentLines = normalizeLineEndings(content).split('\n')

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let match = true
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() !== oldLines[j]) { match = false; break }
    }
    if (match) {
      const idx = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
      const len = contentLines.slice(i, i + oldLines.length).join('\n').length
      return { index: idx, length: len }
    }
  }
  return null
}

// ---------- Level 3: Whitespace Normalized ----------
function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function whitespaceNormalizedMatch(content: string, oldString: string): MatchResult | null {
  const normOld = collapseWhitespace(normalizeLineEndings(oldString))
  const normContent = collapseWhitespace(normalizeLineEndings(content))
  const idx = normContent.indexOf(normOld)
  if (idx < 0) return null

  // Map back to original content position
  let origIdx = 0
  let normIdx = 0
  while (normIdx < idx && origIdx < content.length) {
    if (content[origIdx].match(/\s/)) { origIdx++; continue }
    if (normContent[normIdx] === content[origIdx]) { normIdx++; origIdx++; continue }
    origIdx++
  }
  let len = 0
  let matched = 0
  while (matched < normOld.length && origIdx + len < content.length) {
    if (content[origIdx + len].match(/\s/)) { len++; continue }
    matched++
    len++
  }
  return { index: origIdx, length: len }
}

// ---------- Level 4: Indentation Flexible ----------
function trimLeadingWhitespace(s: string): string {
  return s.split('\n').map(l => l.replace(/^\s+/, '')).join('\n')
}

export function indentationFlexibleMatch(content: string, oldString: string): MatchResult | null {
  return lineTrimmedMatch(trimLeadingWhitespace(content), trimLeadingWhitespace(oldString))
}

// ---------- Level 5: Context Aware (anchor first/last line, fuzzy middle) ----------
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

export function contextAwareMatch(content: string, oldString: string): MatchResult | null {
  const oldLines = normalizeLineEndings(oldString).split('\n')
  const contentLines = normalizeLineEndings(content).split('\n')
  if (oldLines.length < 3) return null

  const firstLine = oldLines[0].trim()
  const lastLine = oldLines[oldLines.length - 1].trim()
  const middleLines = oldLines.slice(1, -1)

  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue
    if (contentLines[i + oldLines.length - 1].trim() !== lastLine) continue

    let matchCount = 0
    for (let j = 1; j < oldLines.length - 1; j++) {
      const sim = similarity(contentLines[i + j].trim(), middleLines[j - 1].trim())
      if (sim >= 0.5) matchCount++
    }

    const threshold = Math.ceil(middleLines.length * 0.5)
    if (matchCount >= threshold) {
      const idx = contentLines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0)
      const len = contentLines.slice(i, i + oldLines.length).join('\n').length
      return { index: idx, length: len }
    }
  }
  return null
}

// ---------- Master Matcher ----------
export const matchers: Array<{ name: string; match: (c: string, o: string) => MatchResult | null }> = [
  { name: 'exact', match: exactMatch },
  { name: 'lineTrimmed', match: lineTrimmedMatch },
  { name: 'whitespaceNormalized', match: whitespaceNormalizedMatch },
  { name: 'indentationFlexible', match: indentationFlexibleMatch },
  { name: 'contextAware', match: contextAwareMatch },
]

export function findBestMatch(content: string, oldString: string): { result: MatchResult; method: string } | null {
  for (const { name, match } of matchers) {
    const result = match(content, oldString)
    if (result) return { result, method: name }
  }
  return null
}
