import { streamChatCompletion } from '../llm/client.js'

const MAX_SOURCE_CHARS = 2400
const MAX_TITLE_CHARS = 32

function truncateChars(value: string, max = MAX_TITLE_CHARS): string {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('').trim() : value
}

export function normalizeGeneratedTitle(value: string): string {
  const firstLine = value
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/```$/i, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || ''
  const cleaned = firstLine
    .replace(/^(?:标题|会话标题|title)\s*[:：]\s*/i, '')
    .replace(/^["'“‘`]+|["'”’`]+$/g, '')
    .replace(/[。.!！?？,，;；:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return truncateChars(cleaned)
}

/** Intent-oriented local fallback; used only when the title model is unavailable. */
export function fallbackSessionTitle(input: string): string {
  const flattened = input
    .replace(/```[\s\S]*?```/g, ' 代码内容 ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/^\s*[-*#>]+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  const firstClause = (flattened.split(/[。！？!?；;\n]/).find(part => part.trim()) || flattened)
    .replace(/^(?:请|麻烦|能否|可以)?\s*(?:帮我|给我|替我)?\s*/u, '')
    .replace(/^(?:我想|我需要|现在想要|现在需要)\s*/u, '')
    .trim()
  return truncateChars(firstClause || '新会话') || '新会话'
}

export async function generateSessionTitle(input: {
  content: string
  provider: { base_url: string; api_key: string }
  model: string
  signal?: AbortSignal
}): Promise<string> {
  const source = input.content.trim().slice(0, MAX_SOURCE_CHARS)
  let generated = ''
  let failed = false
  try {
    for await (const chunk of streamChatCompletion({
      baseUrl: input.provider.base_url,
      apiKey: input.provider.api_key,
      model: input.model,
      signal: input.signal,
      messages: [
        {
          role: 'system',
          content: '根据用户的首条消息提炼会话标题。概括核心任务或主题，不要照抄开头。中文控制在 6-18 个字，英文控制在 3-10 个词。只输出标题，不要引号、序号、句号或解释。',
        },
        { role: 'user', content: source },
      ],
    })) {
      if (chunk.type === 'delta' && chunk.text) generated += chunk.text
      if (chunk.type === 'error') { failed = true; break }
    }
  } catch {
    failed = true
  }
  const title = failed ? '' : normalizeGeneratedTitle(generated)
  return title || fallbackSessionTitle(source)
}
