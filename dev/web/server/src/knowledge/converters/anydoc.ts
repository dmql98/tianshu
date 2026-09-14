/**
 * AnyDoc（Firecrawl）外部转换器适配（06 P2 外部转换器路线）。
 *
 * CLI：`anydoc <input> -o <output.md>`（Rust 单二进制，14 种格式 → GFM Markdown）
 * 安装：npm install -g @firecrawl/anydoc
 * 扫描 PDF：需 `--ocr hosted`（Firecrawl Parse 云 OCR，可选，默认本地不启用）
 *
 * 本模块是 converter-registry 的声明补充；实际命令构造在 registry 内。
 */
import type { ConverterMeta } from '../converter-registry.js'

export const anydocConverter: Omit<ConverterMeta, 'installed'> = {
  id: 'anydoc',
  name: 'AnyDoc',
  installCommand: 'npm install -g @firecrawl/anydoc',
  detectCommand: 'anydoc --version',
  inputExtensions: [
    '.doc', '.docx', '.docm', '.ppt', '.pptx', '.xls', '.xlsx',
    '.odt', '.ods', '.odp', '.rtf', '.epub', '.csv', '.pdf',
  ],
}
