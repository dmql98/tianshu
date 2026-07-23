import { resolve, relative } from 'path'
import { realpathSync } from 'fs'

export class PathEscapeError extends Error {
  constructor(msg: string) { super(msg); this.name = 'PathEscapeError' }
}

function realRoot(root: string): string {
  try { return realpathSync(root) } catch { return root }
}

function resolvedSafe(p: string, root: string): boolean {
  const full = resolve(root, p)
  const base = realRoot(root)

  // If both full and root are the same (path was approved as an allowed root),
  // do a string-level containment check instead of requiring filesystem existence.
  // This handles paths that haven't been created yet (e.g., a venv directory
  // that will be created by the approved command).
  const normalizedFull = full.replace(/[/\\]+$/, '')
  const normalizedRoot = root.replace(/[/\\]+$/, '')
  if (normalizedFull === normalizedRoot || normalizedFull.startsWith(normalizedRoot + '\\') || normalizedFull.startsWith(normalizedRoot + '/')) {
    return true
  }

  let target = full
  try { target = realpathSync(full) } catch {
    const parent = resolve(full, '..')
    try { target = realpathSync(parent) } catch { return false }
    if (relative(base, target).startsWith('..')) return false
    return relative(base, full).startsWith('..') === false
  }
  return !relative(base, target).startsWith('..')
}

export function assertPathSafe(p: string, workspaces: string[], allowedRoots?: string[]): void {
  // Resolve p relative to the first workspace first so all subsequent
  // checks (including allowedRoots) use the correct absolute path.
  // p may be relative to workspace (e.g. "../../outside/file.txt"),
  // so resolving against allowedRoot would give wrong results.
  const ws = workspaces[0]
  const absP = resolve(ws, p)

  for (const w of workspaces) {
    if (resolvedSafe(absP, w)) return
  }
  if (allowedRoots) {
    for (const root of allowedRoots) {
      if (resolvedSafe(absP, root)) return
    }
  }
  throw new PathEscapeError(`Path escapes workspace: ${p}`)
}

export function assertPathSafeLegacy(p: string, workspace: string, allowedRoots?: string[]): void {
  assertPathSafe(p, [workspace], allowedRoots)
}

export function findFirstOccurrence(content: string, oldString: string): number {
  return content.indexOf(oldString)
}

export function replaceAllOccurrences(content: string, oldString: string, newString: string): string {
  return content.split(oldString).join(newString)
}
