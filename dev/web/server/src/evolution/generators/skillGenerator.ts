import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import type { SkillDraft } from '../extractors/insightExtractor.js'

const DATA_DIR = process.env.DATA_DIR || resolve(import.meta.dirname, '../../../../../data')
const SKILLS_DIR = resolve(DATA_DIR, 'skills')

export class SkillGenerator {
  static generate(draft: SkillDraft): string {
    const nameSlug = draft.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const dir = resolve(SKILLS_DIR, nameSlug)
    mkdirSync(dir, { recursive: true })

    const content = `# ${draft.name}

${draft.description}

## Trigger
${draft.trigger}

## Steps
${draft.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Examples
${draft.examples.map((e, i) => `### Example ${i + 1}\n\`\`\`\n${e}\n\`\`\``).join('\n\n')}
`

    const filePath = resolve(dir, 'SKILL.md')
    writeFileSync(filePath, content, 'utf-8')
    console.log(`[skill-generator] Generated: ${filePath}`)
    return filePath
  }
}
