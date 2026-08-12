/**
 * 内容层状态（BUILTIN_CONTENT_DEVELOPMENT_PLAN §6）。
 *
 * <dataDir>/content-state.json 记录用户对内置内容的操作状态：
 *   - hidden：被用户隐藏的内置项（普通列表不返回，all=true 可查看）
 *   - lastSeenBuiltinVersion：上次见过的内置发行版本
 *
 * 损坏时安全回退为空状态，不允许抛错阻塞启动；写操作原子替换。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { contentStateFile } from '../data-paths.js'

export interface ContentState {
  schemaVersion: 1
  lastSeenBuiltinVersion?: string
  hidden: {
    characters: string[]
    skills: string[]
  }
}

const EMPTY: ContentState = {
  schemaVersion: 1,
  hidden: { characters: [], skills: [] },
}

let cached: ContentState | null = null

export function readContentState(): ContentState {
  if (cached) return cached
  const file = contentStateFile()
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<ContentState>
      if (raw && typeof raw === 'object' && raw.schemaVersion === 1) {
        cached = {
          schemaVersion: 1,
          lastSeenBuiltinVersion: typeof raw.lastSeenBuiltinVersion === 'string'
            ? raw.lastSeenBuiltinVersion
            : undefined,
          hidden: {
            characters: Array.isArray(raw.hidden?.characters)
              ? (raw.hidden.characters as string[])
              : [],
            skills: Array.isArray(raw.hidden?.skills)
              ? (raw.hidden.skills as string[])
              : [],
          },
        }
        return cached
      }
    } catch {
      /* corrupt state → safe empty state */
    }
  }
  cached = { ...EMPTY, hidden: { characters: [], skills: [] } }
  return cached
}

function persist(state: ContentState): void {
  const file = contentStateFile()
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(temp, file)
  cached = state
}

export function resetContentStateCache(): void {
  cached = null
}

export function setHidden(kind: 'characters' | 'skills', id: string, hidden: boolean): ContentState {
  const state = readContentState()
  const list = state.hidden[kind].filter(item => item !== id)
  if (hidden) list.push(id)
  const next: ContentState = {
    ...state,
    hidden: { ...state.hidden, [kind]: list },
  }
  persist(next)
  return next
}

export function isHidden(kind: 'characters' | 'skills', id: string): boolean {
  return readContentState().hidden[kind].includes(id)
}

export function setLastSeenBuiltinVersion(version: string): void {
  const state = readContentState()
  if (state.lastSeenBuiltinVersion === version) return
  persist({ ...state, lastSeenBuiltinVersion: version })
}
