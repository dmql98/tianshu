// Add `"source": "builtin"` to the top level of every builtin character.json and
// skill-package.json under content/builtin. Skips files that already have it.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

const root = resolve(import.meta.dirname, '..', 'content', 'builtin')
let changed = 0
let skipped = 0

function addSource(file) {
  if (!existsSync(file)) return
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  if (raw.source === 'builtin') { skipped++; return }
  // rebuild with source inserted after the first key to keep diff readable
  const entries = Object.entries(raw)
  const hasSource = entries.some(([k]) => k === 'source')
  if (hasSource) { skipped++; return }
  const withSource = { source: 'builtin', ...raw }
  writeFileSync(file, JSON.stringify(withSource, null, 2) + '\n', 'utf-8')
  changed++
  console.log('  +source:builtin ' + file.replace(root + '\\', ''))
}

// characters: content/builtin/characters/<id>/character.json
const charsRoot = resolve(root, 'characters')
if (existsSync(charsRoot)) {
  for (const id of readdirSync(charsRoot, { withFileTypes: true })) {
    if (!id.isDirectory()) continue
    addSource(resolve(charsRoot, id.name, 'character.json'))
  }
}

// skills: content/builtin/skills/<category>/<pkg>/skill-package.json
const skillsRoot = resolve(root, 'skills')
if (existsSync(skillsRoot)) {
  for (const cat of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue
    const catDir = resolve(skillsRoot, cat.name)
    for (const pkg of readdirSync(catDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      addSource(resolve(catDir, pkg.name, 'skill-package.json'))
    }
  }
}

console.log(`\n[tag-builtin] changed=${changed} already=${skipped}`)
