import { randomUUID } from 'crypto'
import { getDb } from '../../db/schema.js'

export interface GoalRow {
  id: string
  session_id: string
  outcome: string
  constraints: string | null
  verification: string | null
  budget_tokens: number | null
  used_input_tokens: number
  used_output_tokens: number
  status: 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  wake_condition: string | null
  current_run_id: string | null
  created_at: number
  updated_at: number
}

export interface PlanRow {
  id: string
  session_id: string
  goal_id: string | null
  version: number
  status: 'active' | 'completed' | 'superseded' | 'failed'
  created_at: number
  updated_at: number
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped' | 'failed'

export interface PlanStepRow {
  id: string
  plan_id: string
  ordinal: number
  title: string
  status: PlanStepStatus
  depends_on: string | null
  verification: string | null
  evidence: string | null
  created_at: number
}

export const goalStore = {
  get(id: string): GoalRow | null {
    return getDb().prepare('SELECT * FROM goals WHERE id = ?').get(id) as GoalRow | null
  },
  listForSession(sessionId: string): GoalRow[] {
    return getDb().prepare('SELECT * FROM goals WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as GoalRow[]
  },
  create(input: {
    id?: string
    session_id: string
    outcome: string
    constraints?: string | null
    verification?: string | null
    budget_tokens?: number | null
    wake_condition?: string | null
  }): GoalRow {
    const now = Date.now()
    const row: GoalRow = {
      id: input.id || `goal_${randomUUID()}`,
      session_id: input.session_id,
      outcome: input.outcome,
      constraints: input.constraints || null,
      verification: input.verification || null,
      budget_tokens: input.budget_tokens ?? null,
      used_input_tokens: 0,
      used_output_tokens: 0,
      status: 'active',
      wake_condition: input.wake_condition || null,
      current_run_id: null,
      created_at: now,
      updated_at: now,
    }
    getDb().prepare(`
      INSERT INTO goals (
        id, session_id, outcome, constraints, verification, budget_tokens,
        used_input_tokens, used_output_tokens, status, wake_condition, current_run_id,
        created_at, updated_at
      ) VALUES (
        @id, @session_id, @outcome, @constraints, @verification, @budget_tokens,
        @used_input_tokens, @used_output_tokens, @status, @wake_condition, @current_run_id,
        @created_at, @updated_at
      )
    `).run(row)
    return row
  },
  update(id: string, patch: Partial<GoalRow>): GoalRow | null {
    const existing = this.get(id)
    if (!existing) return null
    const updated: GoalRow = { ...existing, ...patch, updated_at: Date.now() }
    getDb().prepare(`
      UPDATE goals SET
        outcome = @outcome, constraints = @constraints, verification = @verification,
        budget_tokens = @budget_tokens, used_input_tokens = @used_input_tokens,
        used_output_tokens = @used_output_tokens, status = @status,
        wake_condition = @wake_condition, current_run_id = @current_run_id,
        updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    return updated
  },
  addUsage(id: string, inputTokens: number, outputTokens: number): GoalRow | null {
    const goal = this.get(id)
    if (!goal) return null
    return this.update(id, {
      used_input_tokens: goal.used_input_tokens + inputTokens,
      used_output_tokens: goal.used_output_tokens + outputTokens,
    })
  },
  /** Total budget consumed (mixed input/output tokens, budget_tokens is the cap). */
  usedTokens(goal: GoalRow): number {
    return goal.used_input_tokens + goal.used_output_tokens
  },
}

export const planStore = {
  get(id: string): PlanRow | null {
    return getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | null
  },
  getActive(sessionId: string): PlanRow | null {
    return getDb().prepare(
      "SELECT * FROM plans WHERE session_id = ? AND status = 'active' ORDER BY version DESC LIMIT 1",
    ).get(sessionId) as PlanRow | null
  },
  steps(planId: string): PlanStepRow[] {
    return getDb().prepare(
      'SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY ordinal ASC',
    ).all(planId) as PlanStepRow[]
  },
  createPlan(input: {
    id?: string
    session_id: string
    goal_id?: string | null
    version?: number
    steps: Array<{ title: string; depends_on?: string; verification?: string }>
  }): PlanRow {
    const db = getDb()
    const now = Date.now()
    let version = input.version
    if (version === undefined) {
      const latest = db.prepare('SELECT MAX(version) AS v FROM plans WHERE session_id = ?').get(input.session_id) as { v: number | null }
      version = (latest.v || 0) + 1
    }
    return db.transaction(() => {
      db.prepare(
        "UPDATE plans SET status = 'superseded', updated_at = ? WHERE session_id = ? AND status = 'active'",
      ).run(now, input.session_id)
      const row: PlanRow = {
        id: input.id || `plan_${randomUUID()}`,
        session_id: input.session_id,
        goal_id: input.goal_id || null,
        version,
        status: 'active',
        created_at: now,
        updated_at: now,
      }
      db.prepare(`
        INSERT INTO plans (id, session_id, goal_id, version, status, created_at, updated_at)
        VALUES (@id, @session_id, @goal_id, @version, @status, @created_at, @updated_at)
      `).run(row)
      const insert = db.prepare(`
        INSERT INTO plan_steps (id, plan_id, ordinal, title, status, depends_on, verification, evidence, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, ?)
      `)
      input.steps.forEach((step, index) => {
        insert.run(`pstep_${randomUUID()}`, row.id, index + 1, step.title, step.depends_on || null, step.verification || null, now)
      })
      return row
    })()
  },
  supersedeActive(sessionId: string, keepPlanId?: string): void {
    getDb().prepare(
      "UPDATE plans SET status = 'superseded', updated_at = ? WHERE session_id = ? AND status = 'active' AND id != ?",
    ).run(Date.now(), sessionId, keepPlanId || '')
  },
  setStepStatus(stepId: string, status: PlanStepStatus, evidence?: string | null): PlanStepRow | null {
    const row = getDb().prepare('SELECT * FROM plan_steps WHERE id = ?').get(stepId) as PlanStepRow | undefined
    if (!row) return null
    getDb().prepare(`
      UPDATE plan_steps SET status = ?, evidence = COALESCE(?, evidence) WHERE id = ?
    `).run(status, evidence ?? null, stepId)
    const updated = this.getStep(stepId)
    if (updated && status === 'completed') this.maybeCompletePlan(updated.plan_id)
    return updated
  },
  getStep(stepId: string): PlanStepRow | null {
    return getDb().prepare('SELECT * FROM plan_steps WHERE id = ?').get(stepId) as PlanStepRow | null
  },
  /** First incomplete step in ordinal order (dependencies ignored for MVP). */
  nextPendingStep(planId: string): PlanStepRow | null {
    return getDb().prepare(
      "SELECT * FROM plan_steps WHERE plan_id = ? AND status IN ('pending', 'in_progress') ORDER BY ordinal ASC LIMIT 1",
    ).get(planId) as PlanStepRow | null
  },
  allCompleted(planId: string): boolean {
    const row = getDb().prepare(
      "SELECT COUNT(*) AS c FROM plan_steps WHERE plan_id = ? AND status != 'completed' AND status != 'skipped'",
    ).get(planId) as { c: number }
    return row.c === 0
  },
  completePlan(planId: string): void {
    getDb().prepare(
      "UPDATE plans SET status = 'completed', updated_at = ? WHERE id = ?",
    ).run(Date.now(), planId)
  },
  maybeCompletePlan(planId: string): void {
    if (this.allCompleted(planId)) this.completePlan(planId)
  },
  /** Unmet steps for a rejected submission. */
  unmetSteps(planId: string): PlanStepRow[] {
    return getDb().prepare(
      "SELECT * FROM plan_steps WHERE plan_id = ? AND status NOT IN ('completed', 'skipped') ORDER BY ordinal ASC",
    ).all(planId) as PlanStepRow[]
  },
}
