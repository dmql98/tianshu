# P0-2 项②：direct 模式切换提示注入（仿 lastPlanAlert「变化才注入」，走 systemAlerts 尾部）。
import sys
from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'src/agent/loop/loop-engine.ts'
s = p.read_text(encoding='utf-8').replace('\r\n', '\n')

pairs = [
    # 1) 定义 mode alert 常量（紧跟 policyLabel 之后）
    (
"""  const policyLabel = executionMode === 'direct' ? 'Direct' : executionMode === 'plan_first' ? 'Plan-first' : 'Goal'""",
"""  const policyLabel = executionMode === 'direct' ? 'Direct' : executionMode === 'plan_first' ? 'Plan-first' : 'Goal'
  // 直接对话模式提示（P0-2）：切换进 direct 时注入一次——模型自判是否创建计划/目标。
  // 仿 lastPlanAlert「变化才注入」：只在该轮未注入 plan alert 且内容变化时 push，
  // 稳态轮次不重复 → 尾部动态上下文保持字节稳定（provider 前缀缓存不受影响）。
  const directModeAlert = '[Policy Direct] 当前为直接对话模式：是否创建计划/目标由你自行判断。'""",
    ),
    # 2) 新增 lastModeAlert 状态（与 lastPlanAlert/lastGoalAlert 并列）
    (
"""  let lastPlanAlert = ''
  let lastGoalAlert = ''""",
"""  let lastPlanAlert = ''
  let lastGoalAlert = ''
  let lastModeAlert = ''""",
    ),
    # 3) plan 注入块：加 planAlertPushed 标记，并在其后注入 direct 模式提示
    (
"""    const plan = currentPlan()
    if (!plan) {
      if (policyLabel !== 'Direct') {
        const noPlanAlert = `[Policy ${policyLabel}] 当前没有有效计划。先调用 create_plan 把任务拆成有序步骤并注明验证方式，再执行步骤。`
        if (noPlanAlert !== lastPlanAlert) {
          composeCtx.systemAlerts!.push(noPlanAlert)
          lastPlanAlert = noPlanAlert
        }
      }
    } else {
      const steps = planStore.steps(plan.id)
      const planRule = policyLabel === 'Direct'
        ? '\\n这是可选计划：可以继续按计划推进，也可以直接完成任务；若推进计划，请用 update_plan_step 同步状态。'
        : '\\n开始步骤前调用 update_plan_step 标记 in_progress；验证完成后调用 update_plan_step 标记 completed 并附 evidence。'
      const planAlert =
        `[Policy ${policyLabel}] 当前计划 v${plan.version}：\\n` +
        steps.map(step => `${step.ordinal}. [${step.status}] ${step.title}${step.verification ? `（验证：${step.verification}）` : ''}`).join('\\n') +
        planRule
      if (planAlert !== lastPlanAlert) {
        composeCtx.systemAlerts!.push(planAlert)
        lastPlanAlert = planAlert
      }
    }""",
"""    const plan = currentPlan()
    let planAlertPushed = false
    if (!plan) {
      if (policyLabel !== 'Direct') {
        const noPlanAlert = `[Policy ${policyLabel}] 当前没有有效计划。先调用 create_plan 把任务拆成有序步骤并注明验证方式，再执行步骤。`
        if (noPlanAlert !== lastPlanAlert) {
          composeCtx.systemAlerts!.push(noPlanAlert)
          lastPlanAlert = noPlanAlert
          planAlertPushed = true
        }
      }
    } else {
      const steps = planStore.steps(plan.id)
      const planRule = policyLabel === 'Direct'
        ? '\\n这是可选计划：可以继续按计划推进，也可以直接完成任务；若推进计划，请用 update_plan_step 同步状态。'
        : '\\n开始步骤前调用 update_plan_step 标记 in_progress；验证完成后调用 update_plan_step 标记 completed 并附 evidence。'
      const planAlert =
        `[Policy ${policyLabel}] 当前计划 v${plan.version}：\\n` +
        steps.map(step => `${step.ordinal}. [${step.status}] ${step.title}${step.verification ? `（验证：${step.verification}）` : ''}`).join('\\n') +
        planRule
      if (planAlert !== lastPlanAlert) {
        composeCtx.systemAlerts!.push(planAlert)
        lastPlanAlert = planAlert
        planAlertPushed = true
      }
    }
    // 直接对话模式：该轮未注入 plan alert 时，注入一次模式提示（每次切换/run 首轮）。
    if (policyLabel === 'Direct' && !planAlertPushed && directModeAlert !== lastModeAlert) {
      composeCtx.systemAlerts!.push(directModeAlert)
      lastModeAlert = directModeAlert
    }""",
    ),
]

for old, new in pairs:
    n = s.count(old)
    if n == 0:
        print(f'MISS: {old[:60]!r}')
        sys.exit(1)
    s = s.replace(old, new, 1)

p.write_text(s.replace('\n', '\r\n'), encoding='utf-8')
print('OK loop-engine.ts')