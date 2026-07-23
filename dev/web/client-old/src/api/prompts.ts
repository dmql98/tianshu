import { apiGet, apiPut } from './client'

export async function fetchDefaultPrompt(): Promise<string> {
  const res = await apiGet<{ content: string }>('/api/prompts/default')
  return res.content
}

export async function saveDefaultPrompt(content: string): Promise<void> {
  await apiPut('/api/prompts/default', { content })
}
