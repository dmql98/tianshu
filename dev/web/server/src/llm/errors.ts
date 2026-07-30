function getErrorCode(err: any): string {
  return String(err?.cause?.code || err?.code || '').trim()
}

export function describeTransportError(err: unknown): string {
  const value = err as any
  const message = String(value?.message || value || 'LLM request failed').trim()
  const code = getErrorCode(value)
  const causeMessage = String(value?.cause?.message || '').trim()

  if (!code && (!causeMessage || causeMessage === message)) return message

  const details = [code, causeMessage && causeMessage !== message ? causeMessage : '']
    .filter(Boolean)
    .join(': ')
  return `${message} [${details}]`
}

export function isTransientLLMError(errorText: string): boolean {
  const msg = errorText.toLowerCase()
  return msg.includes('fetch failed') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('overloaded') ||
    msg.includes('internal server error') ||
    msg.includes('service unavailable') ||
    msg.includes('temporarily') ||
    msg.includes('try again') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('und_err_')
}
