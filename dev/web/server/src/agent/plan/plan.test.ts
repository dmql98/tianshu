/**
 * Run: npx tsx src/agent/plan/plan.test.ts
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpData = mkdtempSync(join(tmpdir(), 'tianshu-plan-'))
process.env.TIANSHU_DATA_DIR = tmpData

const { getDb, closeDb } = await import('../../db/schema.js')
const { sessionStore } = await import('../../db/sessionStore.js')
const { goalStore, planStore } = await import('./plan-store.js')
const { evaluateSubmission } = await import('../loop/completion-evaluator.js')

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${message}`)
}

const db = getDb()
const NOW = Date.now()

function seedCharacter(characterId: string, revisionId: string) {
  db.prepare(`
    INSERT INTO character_definitions (id, current_revision_id, status, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?)
  `).run(characterId, revisionId, NOW, NOW)
  db.prepare(`
    INSERT INTO character_revisions (id, character_id, revision_no, manifest_hash, snapshot, visual_manifest, created_at)
    VALUES (?, ?, 1, 'h', '{}', NULL, ?)
  `).run(revisionId, characterId, NOW)
}

seedCharacter('char_plan', 'rev_plan')

try {
  const session = sessionStore.create({ id: 'sess_plan', character_id: 'char_plan' })

  // ---- plan creation, supersede and step lifecycle --------------------------
  {
    const plan = planStore.createPlan({
      session_id: session.id,
      steps: [
        { title: '调研', verification: '列出候选' },
        { title: '实现' },
        { title: '验证' },
      ],
    })
    const steps = planStore.steps(plan.id)
    assert(steps.length === 3 && steps[0].ordinal === 1, 'steps persisted in order')
    assert(steps.every(s => s.status === 'pending'), 'steps start pending')
    assert(planStore.getActive(session.id)?.id === plan.id, 'plan is active')

    planStore.setStepStatus(steps[0].id, 'in_progress')
    assert(planStore.nextPendingStep(plan.id)?.ordinal === 1, 'in_progress step is the next pending')
    planStore.setStepStatus(steps[0].id, 'completed')
    planStore.setStepStatus(steps[1].id, 'completed')
    planStore.setStepStatus(steps[2].id, 'completed')
    assert(planStore.allCompleted(plan.id), 'all steps completed')
    assert(planStore.get(plan.id)!.status === 'completed', 'plan auto-completed')

    // replan: a new plan supersedes the completed one
    const plan2 = planStore.createPlan({
      session_id: session.id,
      steps: [{ title: '重做' }],
    })
    assert(plan2.version === 2, 'version increments on replan')
    assert(planStore.getActive(session.id)?.id === plan2.id, 'new plan active')
    assert(planStore.get(plan.id)!.status === 'completed', 'completed plan keeps its status')

    // replan while the previous plan is still active supersedes it
    const plan3 = planStore.createPlan({
      session_id: session.id,
      steps: [{ title: '再重做' }],
    })
    assert(plan3.version === 3, 'version increments again')
    assert(planStore.get(plan2.id)!.status === 'superseded', 'active plan superseded by replan')
    console.log('  OK plan lifecycle (create / steps / complete / supersede)')
  }

  // ---- goals: create, usage accounting, pause --------------------------------
  {
    const goal = goalStore.create({
      session_id: session.id,
      outcome: '发布 TianShu v1',
      verification: '包含 changelog 与安装说明',
      budget_tokens: 1000,
    })
    assert(goal.status === 'active', 'goal starts active')
    goalStore.addUsage(goal.id, 400, 200)
    const updated = goalStore.get(goal.id)!
    assert(goalStore.usedTokens(updated) === 600, 'usage accumulated')
    assert(updated.used_input_tokens === 400, 'input charged')
    goalStore.update(goal.id, { status: 'paused' })
    assert(goalStore.get(goal.id)!.status === 'paused', 'pause works')
    console.log('  OK goal create / usage / pause')
  }

  // ---- CompletionEvaluator gates ---------------------------------------------
  {
    const accepted = evaluateSubmission({
      mode: 'direct', planCompleted: false, unmetSteps: [], summary: 'x', evidence: []
    })
    assert(accepted.accepted, 'direct mode always accepts')

    const rejectedPlan = evaluateSubmission({
      mode: 'plan_first', planCompleted: false,
      unmetSteps: [{ ordinal: 2, title: '实现' }],
      summary: 'x', evidence: [],
    })
    assert(!rejectedPlan.accepted && rejectedPlan.unmet[0].includes('实现'), 'plan_first rejects unmet steps')

    const acceptedPlan = evaluateSubmission({
      mode: 'plan_first', planCompleted: true, unmetSteps: [], summary: 'x', evidence: [],
    })
    assert(acceptedPlan.accepted, 'plan_first accepts when all steps done')

    const rejectedGoal = evaluateSubmission({
      mode: 'goal', planCompleted: true, unmetSteps: [],
      goalVerification: '必须附 changelog', summary: '', evidence: [],
    })
    assert(!rejectedGoal.accepted && rejectedGoal.unmet.some(u => u.includes('证据')),
      'goal mode rejects submissions without evidence')

    const acceptedGoal = evaluateSubmission({
      mode: 'goal', planCompleted: true, unmetSteps: [],
      goalVerification: '必须附 changelog', summary: '完成，见 changelog: v1.0.0',
      evidence: ['CHANGELOG.md', 'docs/install.md'],
    })
    assert(acceptedGoal.accepted, 'goal accepts submissions with evidence')
    console.log('  OK CompletionEvaluator submission gates')
  }
} finally {
  closeDb()
  rmSync(tmpData, { recursive: true, force: true })
}

console.log('ALL PLAN TESTS PASSED')
