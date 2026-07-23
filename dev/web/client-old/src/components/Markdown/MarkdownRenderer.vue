<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{
  content: string
}>()

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})

interface RenderSegment {
  type: 'html' | 'code'
  content: string
  language?: string
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const segments = computed<RenderSegment[]>(() => {
  const html = md.render(props.content)
  const result: RenderSegment[] = []
  const codeBlockRegex = /<pre><code(?: class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRegex.exec(html)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'html', content: html.slice(lastIndex, match.index) })
    }
    result.push({
      type: 'code',
      content: decodeHtmlEntities(match[2]),
      language: match[1] || undefined,
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < html.length) {
    result.push({ type: 'html', content: html.slice(lastIndex) })
  }

  return result
})
</script>

<template>
  <div class="markdown-renderer">
    <template v-for="(segment, index) in segments" :key="index">
      <CodeBlock
        v-if="segment.type === 'code'"
        :code="segment.content"
        :language="segment.language"
      />
      <div v-else v-html="segment.content"></div>
    </template>
  </div>
</template>

<style scoped>
.markdown-renderer {
  font-size: 14px;
  line-height: 1.6;
}
.markdown-renderer :deep(h1),
.markdown-renderer :deep(h2),
.markdown-renderer :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
}
.markdown-renderer :deep(p) {
  margin-bottom: 8px;
}
.markdown-renderer :deep(ul),
.markdown-renderer :deep(ol) {
  padding-left: 24px;
  margin-bottom: 8px;
}
.markdown-renderer :deep(code) {
  background: #f5f5f5;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: monospace;
}
.markdown-renderer :deep(pre) {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
}
.markdown-renderer :deep(a) {
  color: #007aff;
  text-decoration: none;
}
.markdown-renderer :deep(a:hover) {
  text-decoration: underline;
}
</style>
