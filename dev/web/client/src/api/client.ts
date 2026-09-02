const API_BASE = import.meta.env.VITE_API_URL || ''

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

/**
 * Default request timeout. Long-running background fetches (run event replay,
 * big session payloads) can legitimately take a while, but a request that never
 * settles — e.g. while the server event loop is busy or a run is stuck — hangs
 * the caller forever (createSession's POST, fetchSessionMessages, the reconnect
 * replay workers). Aborting makes those flows fail fast and recover.
 */
const DEFAULT_TIMEOUT_MS = 30_000

async function fetchWithTimeout(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function apiGet<T>(path: string, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(path, undefined, timeoutMs)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPost<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, timeoutMs)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPut<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiPatch<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  return res.json()
}

export async function apiDelete<T = void>(path: string, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(path, { method: 'DELETE' }, timeoutMs)
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text().catch(() => '')}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
