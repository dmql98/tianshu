import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from '../../src/iconpacks/sanitize.js'

describe('sanitizeSvg', () => {
  it('合法纯图形 SVG 原样通过', () => {
    const r = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h10v10z" fill="#a98a3d"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toContain('<path')
      expect(r.data).toContain('<circle')
      expect(r.data).not.toContain('<script')
    }
  })

  it('剥离 <script> 并拒绝', () => {
    const r = sanitizeSvg('<svg><script>alert(1)</script><path d="M0 0"/></svg>')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('script')
  })

  it('剥离 on* 事件属性', () => {
    const r = sanitizeSvg('<svg><circle cx="5" cy="5" r="2" onclick="alert(2)" onmouseover="x()"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toContain('onclick')
      expect(r.data).not.toContain('onmouseover')
    }
  })

  it('阻断 <a> 子树（含 javascript: URL）', () => {
    const r = sanitizeSvg('<svg><a href="javascript:evil()"><rect width="10" height="10"/></a><path d="M0 0"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toContain('javascript:')
      expect(r.data).not.toContain('<a')
      expect(r.data).not.toContain('<rect') // 子树整体被阻断
      expect(r.data).toContain('<path')
    }
  })

  it('剥离外部 href（外链引用）', () => {
    const r = sanitizeSvg('<svg><use href="https://evil.example/x.svg#icon"/><path d="M0 0"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toContain('https://')
      expect(r.data).toContain('<path')
    }
  })

  it('剥离 style 中的 url() 与 expression', () => {
    const r = sanitizeSvg('<svg><path style="fill:url(http://evil/x);expression(1)" d="M0 0"/></svg>')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).not.toContain('url(')
      expect(r.data).not.toContain('expression')
    }
  })

  it('非 SVG 输入拒绝', () => {
    expect(sanitizeSvg('<html><body>hello</body></html>').ok).toBe(false)
    expect(sanitizeSvg('plain text').ok).toBe(false)
    expect(sanitizeSvg('').ok).toBe(false)
  })

  it('超长输入拒绝', () => {
    expect(sanitizeSvg(`<svg>${'x'.repeat(600 * 1024)}</svg>`).ok).toBe(false)
  })
})
