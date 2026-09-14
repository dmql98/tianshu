/**
 * PaddleOCR 外部转换器适配（06 P2 外部转换器路线）。
 *
 * CLI：`paddleocr pp_structurev3 -i <input> --save_path <outputDir>`
 * 产物：<outputDir>/{stem}.md（PDF 多页自动合并为单 md）
 * 安装：pip install paddleocr[doc-parser]
 *
 * 本模块是 converter-registry 的声明补充；实际命令构造在 registry 内
 * （registry 统一管理探测/缓存/进程调用，此处仅为类型化入口与文档）。
 */
import type { ConverterMeta } from '../converter-registry.js'

export const paddleocrConverter: Omit<ConverterMeta, 'installed'> = {
  id: 'paddleocr',
  name: 'PaddleOCR',
  installCommand: 'pip install paddleocr[doc-parser]',
  detectCommand: 'paddleocr --version',
  inputExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp'],
}
