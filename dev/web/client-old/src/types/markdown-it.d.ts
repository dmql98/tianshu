declare module 'markdown-it' {
  interface MarkdownItOptions {
    html?: boolean
    xhtmlOut?: boolean
    breaks?: boolean
    langPrefix?: string
    linkify?: boolean
    typographer?: boolean
    quotes?: string
    highlight?: (str: string, lang: string) => string
  }

  interface MarkdownIt {
    render(src: string, env?: any): string
    renderInline(src: string, env?: any): string
  }

  interface MarkdownItConstructor {
    new (preset?: string | MarkdownItOptions): MarkdownIt
  }

  const MarkdownIt: MarkdownItConstructor
  export default MarkdownIt
  export type { MarkdownItOptions, MarkdownIt }
}
