/**
 * Canonical tool-call normalization.
 *
 * Durable history may only contain tool calls whose `function.arguments` is
 * valid JSON (an object). Stream assembly produces raw, possibly truncated or
 * malformed arguments; this boundary turns them into canonical calls or an
 * explicit error, so neither history nor real tool execution can see garbage.
 *
 * Case study msocwg0bciq5x4: a `write` call was cut mid-arguments and the
 * half-serialized string entered history, poisoning every replay with an HTTP
 * 400. Everything here exists to make that impossible.
 */

import type { ToolCall } from '../llm/client.js'

export interface CanonicalToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: Record<string, unknown> }
}

export type NormalizeFailure =
  | { kind: 'invalid_json'; toolId: string; toolName: string; detail: string; snippet: string }
  | { kind: 'invalid_shape'; toolId: string; toolName: string; detail: string }
  | { kind: 'missing_identity'; toolId: string; toolName: string; detail: string }

export type NormalizeResult =
  | { ok: true; calls: CanonicalToolCall[] }
  | { ok: false; kind: NormalizeFailure['kind']; calls: CanonicalToolCall[]; failures: NormalizeFailure[] }

const MAX_ARG_SNIPPET = 200

function safeSnippet(raw: string): string {
  return raw.length > MAX_ARG_SNIPPET ? raw.slice(0, MAX_ARG_SNIPPET) + '…' : raw
}

function parseArgs(toolId: string, toolName: string, raw: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; failure: NormalizeFailure } {
  try {
    const value = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        failure: {
          kind: 'invalid_shape',
          toolId, toolName,
          detail: `arguments must be a JSON object, got ${Array.isArray(value) ? 'array' : typeof value}`,
        },
      }
    }
    return { ok: true, value: value as Record<string, unknown> }
  } catch (err: any) {
    return {
      ok: false,
      failure: {
        kind: 'invalid_json',
        toolId, toolName,
        detail: String(err?.message || err),
        snippet: safeSnippet(raw),
      },
    }
  }
}

/**
 * Validate and canonicalize a batch of raw tool calls.
 *
 * Identity checks (non-empty unique id, non-empty name) are structural. The
 * arguments string is parsed to an object. Failures are collected per-call;
 * valid calls are still returned (in `calls`) so the caller can decide between
 * "execute the valid ones" and "reject the whole turn" (see callers).
 */
export function normalizeToolCalls(raw: ToolCall[]): NormalizeResult {
  const calls: CanonicalToolCall[] = []
  const failures: NormalizeFailure[] = []
  const seenIds = new Set<string>()

  for (const tc of raw) {
    const id = (tc.id || '').trim()
    const name = (tc.function?.name || '').trim()
    const rawArgs = tc.function?.arguments || ''

    if (!id || !name) {
      failures.push({
        kind: 'missing_identity',
        toolId: id,
        toolName: name,
        detail: `tool call missing ${!id ? 'id' : 'function name'}`,
      })
      continue
    }
    if (seenIds.has(id)) {
      failures.push({
        kind: 'missing_identity',
        toolId: id, toolName: name,
        detail: `duplicate tool call id ${id}`,
      })
      continue
    }
    seenIds.add(id)

    const parsed = parseArgs(id, name, rawArgs)
    if (!parsed.ok) {
      failures.push(parsed.failure)
      continue
    }
    calls.push({ id, type: 'function', function: { name, arguments: parsed.value } })
  }

  return failures.length > 0
    ? { ok: false, kind: failures[0].kind, calls, failures }
    : { ok: true, calls }
}

/** Build a synthetic `invalid_tool_call` assistant tool call that is always
 *  valid JSON, so the model gets a structured error it can rewrite instead of
 *  the turn failing outright. Mirrors OpenCode's internal invalid tool. */
export function buildInvalidToolCall(
  id: string,
  failure: NormalizeFailure,
): { canonical: CanonicalToolCall; raw: ToolCall } {
  const args: Record<string, unknown> = {
    original_tool: failure.toolName,
    error: failure.kind,
    detail: failure.detail,
    ...(failure.kind === 'invalid_json' ? { argument_preview: failure.snippet } : {}),
  }
  const canonical: CanonicalToolCall = {
    id, type: 'function',
    function: { name: 'invalid_tool_call', arguments: args },
  }
  const raw: ToolCall = {
    id, type: 'function',
    function: { name: 'invalid_tool_call', arguments: JSON.stringify(args) },
  }
  return { canonical, raw }
}
