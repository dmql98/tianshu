import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

function scalar(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalize(file) {
  const content = readFileSync(file, 'utf-8')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error(`Missing frontmatter: ${file}`)
  const lines = match[1].split(/\r?\n/)
  const nameLine = lines.find(line => /^name\s*:/.test(line))
  const descriptionIndex = lines.findIndex(line => /^description\s*:/.test(line))
  if (!nameLine || descriptionIndex < 0) throw new Error(`Missing name or description: ${file}`)

  const name = scalar(nameLine.slice(nameLine.indexOf(':') + 1))
  const descriptionHead = lines[descriptionIndex].slice(lines[descriptionIndex].indexOf(':') + 1).trim()
  let description
  if (descriptionHead === '>' || descriptionHead === '|') {
    const parts = []
    for (let i = descriptionIndex + 1; i < lines.length && /^\s+/.test(lines[i]); i++) {
      const value = lines[i].trim()
      if (value) parts.push(value)
    }
    description = parts.join(descriptionHead === '>' ? ' ' : '\n')
  } else {
    description = scalar(descriptionHead)
  }
  if (!name || !description) throw new Error(`Empty name or description: ${file}`)
  writeFileSync(file, `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${match[2].trimStart()}`, 'utf-8')
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name === 'SKILL.md') normalize(path)
  }
}

for (const arg of process.argv.slice(2)) {
  const target = resolve(arg)
  if (!statSync(target).isDirectory()) throw new Error(`Not a directory: ${target}`)
  walk(target)
}
