import { describe, expect, it } from 'vitest'
import {
  loadModelUsage,
  normalizeModelUsage,
  recordModelUse,
  saveModelUsage,
  topModelKeys,
} from './modelUsage'
import type { ModelUsage } from './modelUsage'

/** 内存版 Storage，模拟 localStorage 行为。 */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

describe('normalizeModelUsage', () => {
  it('drops invalid keys and non-positive counts', () => {
    const normalized = normalizeModelUsage({
      version: 1,
      counts: { 'p::m': 2.9, 'no-separator': 5, 'p::zero': 0, 'p::neg': -1, 'p::nan': Number.NaN },
    })
    expect(normalized).toEqual({ version: 1, counts: { 'p::m': 2 } })
  })

  it('falls back to default on unknown version or malformed input', () => {
    expect(normalizeModelUsage({ version: 99, counts: {} })).toEqual({ version: 1, counts: {} })
    expect(normalizeModelUsage(null)).toEqual({ version: 1, counts: {} })
    expect(normalizeModelUsage('junk')).toEqual({ version: 1, counts: {} })
  })
})

describe('recordModelUse / topModelKeys', () => {
  it('counts uses per model key and ranks by count desc', () => {
    const storage = memoryStorage()
    recordModelUse('a::model-a', storage)
    recordModelUse('a::model-a', storage)
    recordModelUse('a::model-a', storage)
    recordModelUse('b::model-b', storage)
    recordModelUse('b::model-b', storage)
    recordModelUse('c::model-c', storage)

    expect(topModelKeys(3, storage)).toEqual(['a::model-a', 'b::model-b', 'c::model-c'])
    // 超出请求数量时截断
    expect(topModelKeys(2, storage)).toEqual(['a::model-a', 'b::model-b'])
  })

  it('ignores invalid keys', () => {
    const storage = memoryStorage()
    recordModelUse('invalid-key', storage)
    expect(loadModelUsage(storage).counts).toEqual({})
  })

  it('breaks count ties deterministically by key', () => {
    const usage: ModelUsage = { version: 1, counts: { 'z::z': 1, 'a::a': 1 } }
    saveModelUsage(usage, memoryStorage())
    const storage = memoryStorage()
    storage.setItem('tianshu:modelUsage', JSON.stringify(usage))
    expect(topModelKeys(3, storage)).toEqual(['a::a', 'z::z'])
  })
})

describe('loadModelUsage', () => {
  it('returns default when storage is empty or corrupted', () => {
    expect(loadModelUsage(memoryStorage())).toEqual({ version: 1, counts: {} })
    const corrupted = memoryStorage({ 'tianshu:modelUsage': '{not json' })
    expect(loadModelUsage(corrupted)).toEqual({ version: 1, counts: {} })
  })

  it('round-trips through save/load', () => {
    const storage = memoryStorage()
    recordModelUse('p::gpt', storage)
    recordModelUse('p::gpt', storage)
    expect(loadModelUsage(storage)).toEqual({ version: 1, counts: { 'p::gpt': 2 } })
  })
})
