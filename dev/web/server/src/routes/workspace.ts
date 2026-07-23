import { Hono } from 'hono'
import * as fs from 'fs'
import * as path from 'path'
import os from 'os'
import cp from 'child_process'

const workspaceRouter = new Hono()

const HOME = os.homedir()

const QUICK_ACCESS: { name: string; path: string }[] = [
  { name: '桌面', path: path.join(HOME, 'Desktop') },
  { name: '下载', path: path.join(HOME, 'Downloads') },
  { name: '文档', path: path.join(HOME, 'Documents') },
  { name: '项目根目录', path: process.cwd() },
].filter(e => { try { return fs.existsSync(e.path) } catch { return false } })

function getAvailableDrives(): string[] {
  if (process.platform !== 'win32') return []
  try {
    const out = cp.execSync('wmic logicaldisk get name', { encoding: 'utf8', timeout: 3000 })
    return out.split(/\s+/).filter(s => /^[A-Z]:$/.test(s)).map(s => s + '\\')
  } catch {
    return []
  }
}

interface DirEntry {
  name: string
  path: string
  isDir: boolean
}

function listDir(dirPath: string): DirEntry[] {
  const entries: DirEntry[] = []
  let names: string[]
  try {
    names = fs.readdirSync(dirPath)
  } catch {
    return entries
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const fullPath = path.join(dirPath, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(fullPath)
    } catch {
      continue
    }
    entries.push({ name, path: fullPath, isDir: stat.isDirectory() })
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

workspaceRouter.get('/list', (c) => {
  const rawPath = c.req.query('path') || ''
  const targetPath = rawPath ? path.resolve(rawPath) : ''

  if (!targetPath) {
    const drives = getAvailableDrives()
    const quickItems = QUICK_ACCESS.filter(q => !drives.includes(q.path))
    const entries = drives.map(p => ({ name: p, path: p, isDir: true }))
      .concat(quickItems.map(q => ({ name: q.name, path: q.path, isDir: true })))
    return c.json({ entries, currentPath: '', parentPath: null })
  }

  if (!fs.existsSync(targetPath)) {
    return c.json({ error: 'Path not found' }, 404)
  }

  const entries = listDir(targetPath)
  const parentPath = path.dirname(targetPath)

  const isRoot = process.platform === 'win32'
    ? /^[A-Za-z]:\\$/.test(targetPath)
    : targetPath === '/'

  return c.json({
    entries,
    currentPath: targetPath,
    parentPath: isRoot ? null : parentPath,
  })
})

workspaceRouter.post('/resolve', async (c) => {
  const { name } = await c.req.json()
  if (!name || typeof name !== 'string') return c.json({ path: null })
  const trimmed = name.trim()
  if (fs.existsSync(trimmed)) return c.json({ path: path.resolve(trimmed) })
  return c.json({ path: null })
})

export default workspaceRouter
