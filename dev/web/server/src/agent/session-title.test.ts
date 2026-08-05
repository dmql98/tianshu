import { fallbackSessionTitle, normalizeGeneratedTitle } from './session-title.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`)
}

assert(normalizeGeneratedTitle('标题：安装 Drawio Skill。') === '安装 Drawio Skill', 'removes title prefix and punctuation')
assert(normalizeGeneratedTitle('“修复 Plan-first 状态机”') === '修复 Plan-first 状态机', 'removes wrapping quotes')
assert(fallbackSessionTitle('请帮我修复会话列表的自动命名问题。后面还有说明') === '修复会话列表的自动命名问题', 'fallback extracts intent clause')
assert(Array.from(normalizeGeneratedTitle('这是一个非常非常非常非常非常非常非常非常长的自动生成会话标题')).length <= 32, 'title length is bounded')

console.log('ALL SESSION TITLE TESTS PASSED')
