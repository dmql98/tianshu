import { getDb } from '../db/schema.js'
import { resolveSkillReference } from './skill-catalog.js'

export interface SessionSkillActivation {
  session_id: string
  package_id: string
  skill_id: string
  content_hash: string
  activated_at: number
  status: 'active' | 'inactive'
}

export const sessionSkillStore = {
  list(sessionId: string): SessionSkillActivation[] {
    return getDb().prepare(`
      SELECT session_id, package_id, skill_id, content_hash, activated_at, status
      FROM session_skill_activations
      WHERE session_id = ? AND status = 'active'
      ORDER BY package_id, skill_id
    `).all(sessionId) as SessionSkillActivation[]
  },

  activate(sessionId: string, packageId: string, skillId: string, contentHash: string): void {
    getDb().prepare(`
      INSERT INTO session_skill_activations(session_id, package_id, skill_id, content_hash, activated_at, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON CONFLICT(session_id, package_id, skill_id) DO UPDATE SET
        content_hash = excluded.content_hash,
        activated_at = excluded.activated_at,
        status = 'active'
    `).run(sessionId, packageId, skillId, contentHash, Date.now())
  },

  deactivate(sessionId: string, packageId: string, skillId: string): boolean {
    return getDb().prepare(`
      UPDATE session_skill_activations SET status = 'inactive'
      WHERE session_id = ? AND package_id = ? AND skill_id = ? AND status = 'active'
    `).run(sessionId, packageId, skillId).changes > 0
  },

  bodies(sessionId: string): Array<{ ref: string; body: string }> {
    return this.list(sessionId).flatMap(row => {
      const ref = `${row.package_id}/${row.skill_id}`
      const found = resolveSkillReference(ref)
      return found ? [{ ref, body: found.body }] : []
    })
  },
}
