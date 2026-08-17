import { startTianshuServer } from '../dist/app.js'

process.env.TIANSHU_DATA_DIR = 'C:/Users/dmql/AppData/Local/Temp/opencode/tianshu-smoke-iconpacks'
process.env.TIANSHU_BUILTIN_CONTENT_DIR = 'C:/Users/dmql/Documents/tianshu/dev/content/builtin'
const server = await startTianshuServer({ host: '127.0.0.1', port: 3499 })

const base = server.url
const j = (r) => r.json()
try {
  let r = await fetch(`${base}/api/iconpacks`)
  const list = await j(r)
  console.log('PACKS:', list.packs.map(p => `${p.id}[${p.source}${p.readOnly ? '/ro' : ''}]`).join(', '))
  const lucide = list.packs.find(p => p.id === 'lucide')
  console.log('lucide slots:', lucide && Object.keys(lucide.slots).length)

  const assetFile = lucide.slots['nav-chat'].url.split('/').pop()
  r = await fetch(`${base}/api/iconpacks/lucide/assets/${assetFile}`)
  console.log('GET builtin lucide asset:', r.status, r.headers.get('content-type'), (await r.text()).slice(0, 60))

  r = await fetch(`${base}/api/iconpacks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '我的图标库' }) })
  const pack = await j(r)
  console.log('POST create:', pack.id, pack.source)

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  const form = new FormData()
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), 'chat.svg')
  form.append('tint', 'true')
  r = await fetch(`${base}/api/iconpacks/${pack.id}/slots/nav-chat`, { method: 'PUT', body: form })
  console.log('PUT slot:', (await j(r)).slotCount)

  r = await fetch(`${base}/api/iconpacks/lucide/slots/nav-chat`, { method: 'PUT', body: form })
  console.log('PUT builtin slot (should reject):', r.status, (await r.text()).slice(0, 40))

  r = await fetch(`${base}/api/iconpacks/lucide`, { method: 'DELETE' })
  console.log('DELETE builtin (should reject):', r.status, (await r.text()).slice(0, 40))

  r = await fetch(`${base}/api/iconpacks/${pack.id}`, { method: 'DELETE' })
  console.log('DELETE user:', (await j(r)).ok)
} catch (err) {
  console.error('SMOKE FAILED:', err)
} finally {
  await server.close()
  process.exit(0)
}