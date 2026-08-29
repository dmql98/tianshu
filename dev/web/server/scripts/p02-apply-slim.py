# P0-2 描述瘦身实施（场景 C：激进 + 压缩协议注记），一次性批量替换。
# CRLF 安全：先归一化 \r\n → \n，替换后在写出时统一换回 \r\n。
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EDITS: list[tuple[str, list[tuple[str, str]]]] = [
    # ────────────────────────── control-registry.ts ──────────────────────────
    ('src/agent/loop/control-registry.ts', [
        # 协议注记压缩（保留测试断言的两处子串）
        (
"""const EXCLUSIVITY_NOTE =
  '\\n\\n⚠️ 协议约束：控制动作不能与其他控制动作或 delegate_to_agent 在同一轮发出（整批拒绝）。' +
  '可与普通工具同轮发出：普通工具会先执行，控制动作随后生效。'""",
"""const EXCLUSIVITY_NOTE =
  '\\n\\n⚠️ 协议约束：控制动作不能与其他控制动作或 delegate_to_agent 同轮发出（整批拒绝）；可与普通工具同轮发出（普通工具先执行）。'""",
        ),
        # update_plan_step
        (
"        description: '更新当前执行计划中的一个步骤。开始执行时标记 in_progress；完成验证后标记 completed 并附 evidence。Plan-first / Goal 模式必须用它推进计划，不能用 create_plan 冒充进度更新。',",
"        description: '更新计划步骤状态：执行 in_progress，验证完成 completed 附 evidence；Plan-first/Goal 模式必须用它推进计划，不能用 create_plan 冒充进度更新。',",
        ),
        (
"            ordinal: { type: 'number', description: '当前有效计划中的步骤序号（从 1 开始）' },",
"            ordinal: { type: 'number' },",
        ),
        (
"""            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped', 'failed'],
              description: '步骤的新状态',
            },""",
"""            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped', 'failed'],
            },""",
        ),
        (
"            evidence: { type: 'string', description: '完成证据、验证结果或阻塞原因' },",
"            evidence: { type: 'string' },",
        ),
        # create_plan
        (
"        description: '创建或更新执行计划（Plan-first / Goal 模式必用）。把任务拆成有序步骤；步骤完成后调用 submit_result 提交。',",
"        description: '创建执行计划：拆成有序步骤并注明验证方式；Plan-first/Goal 必用，Direct 可选；完成后 submit_result 提交。',",
        ),
        (
"            goal: { type: 'string', description: '计划要达成的目标（可选，默认继承任务）' },",
"            goal: { type: 'string' },",
        ),
        (
"              description: '有序步骤列表',",
"              description: '有序步骤列表（title 必填，可带 depends_on/verification）',",
        ),
        (
"            verification: { type: 'string', description: '整体完成验证标准（可选）' },",
"            verification: { type: 'string' },",
        ),
        # create_goal
        (
"        description: '为当前会话创建目标（Goal）。长期或需要多步推进的任务应先用它创建目标（含验证标准），再 create_plan 拆步骤。已有进行中的目标时会被拒绝（先 complete_goal 完成）。',",
"        description: '创建会话目标（Goal）：outcome 必填；已有进行中目标会被拒绝（先 complete_goal）；跨 Run 预算/暂停才用。',",
        ),
        (
"            outcome: { type: 'string', description: '要达成的目标结果（必填）' },",
"            outcome: { type: 'string', description: '要达成的目标结果' },",
        ),
        (
"            constraints: { type: 'string', description: '约束条件（可选）' },",
"            constraints: { type: 'string' },",
        ),
        (
"            verification: { type: 'string', description: '验证标准：如何判断目标已达成（可选但推荐）' },",
"            verification: { type: 'string' },",
        ),
        (
"            budget_tokens: { type: 'number', description: '跨 Run 的 token 预算上限（可选）' },",
"            budget_tokens: { type: 'number' },",
        ),
        # get_goal / complete_goal
        (
"        description: '查询当前会话的目标（Goal）状态：目标内容、验证标准、状态与已用 token。无目标时返回提示。',",
"        description: '查询当前会话目标（Goal）状态。',",
        ),
        (
"        description: '将当前进行中的目标标记为已完成。仅在目标确实达成后调用；通常配合 submit_result 一起交付。',",
"        description: '将当前进行中目标标记为已完成（配合 submit_result）。',",
        ),
        (
"            summary: { type: 'string', description: '达成摘要（可选）' },",
"            summary: { type: 'string' },",
        ),
        # delegate_to_agent（补回 targets 为空勿调用语义；保留「连续调用」子串）
        (
"""        description:
          '委托子任务给 targets 中列出的角色（仅顶层会话可调用，子会话无法再委托）。' +
          '适合场景：需要上下文隔离的大范围调研/检索、需要独立视角的验证或评审、或当前会话预算/轮数不足的长任务。' +
          '子 agent 在独立会话中执行并返回结果；它有自己的角色人设与记忆，但看不到本会话上下文，' +
          '因此 task 必须自包含（说明背景、要求做什么、要返回什么格式）。' +
          '拿到结果后必须综合/转述给用户，子 agent 的结果用户不可见。' +
          '分配规则：仅在目标任务明显属于某 target 的专长、且自己处理会消耗大量上下文时才委托；' +
          '能直接用现有工具（read/grep/glob 等）快速解决的小事不要委托；没有合适角色时不要委托，自己做。' +
          '需要多个角色配合时（如先调研再评审、或塔罗+易经综合解答），可在同一回复中连续调用多个 delegate_to_agent 并行发起。' +
          '若描述中未列出可委托目标（targets 为空），说明当前未配置可委托角色，请勿调用。',""",
"""        description: '委托子任务给 targets 中的角色（仅顶层会话）：子 agent 独立会话执行、看不到本会话上下文，task 必须自包含；结果转述给用户。小事别委托、无合适角色不调用；多角色可连续调用多个并行发起；描述中未列出 targets 时表示未配置可委托角色，勿调用。',""",
        ),
        (
"            task: { type: 'string', description: '子任务描述' },",
"            task: { type: 'string', description: '子任务描述（自包含：背景+要做什么+返回格式）' },",
        ),
        (
"            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'], description: '子任务审批模式（可选，默认继承父会话）' },",
"            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'] },",
        ),
        # send_message_to_subagent
        (
"""        description:
          '给本会话已存在的子 agent 会话续跑一个新 turn（P4 多轮：先 delegate_to_agent 建子会话，之后可用本工具让同一子 agent 继续执行后续任务）。' +
          '适合：子 agent 首轮结果不完整需要补充调研、需要让同一独立上下文继续深入、或分阶段派活给同一 worker。' +
          'sub_session_id 直接复用此前子代理回注结果开头 "Sub-session: " 后的完整 ID（原样照抄，不要改写），无需用户提供。' +
          '子 agent 执行完成后结果会回注到父会话的对应消息并自动汇报。',""",
"""        description: '给本会话已有的子 agent 续跑新轮（先 delegate_to_agent 建会话）；sub_session_id 照抄 "Sub-session: " 后的完整 ID。',""",
        ),
        (
"            sub_session_id: { type: 'string', description: '目标子会话 ID（必须是本会话已创建的直接子会话）' },",
"            sub_session_id: { type: 'string', description: '目标子会话 ID（本会话已创建的直接子会话）' },",
        ),
        (
"            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'], description: '子任务审批模式（可选，默认继承子会话既有策略）' },",
"            sub_strategy: { type: 'string', enum: ['Read Only', 'Ask Every Change', 'Ask Risky', 'Auto in Workspace', 'Auto Approve'] },",
        ),
        # submit_result / ask_user
        (
"        description: '提交最终结果并完成当前任务。调用时附带最终结果的摘要说明。',",
"        description: '提交最终结果并完成当前任务。',",
        ),
        (
"            evidence: { type: 'array', items: { type: 'string' }, description: '支撑结论的证据文件或工具输出（可选）' },",
"            evidence: { type: 'array', items: { type: 'string' } },",
        ),
        (
"        description: '向用户提出一个必须由用户回答的问题（例如需要确认或输入缺失信息时）。',",
"        description: '向用户提出一个必须由用户回答的问题。',",
        ),
        (
"            question: { type: 'string', description: '需要用户回答的问题' },",
"            question: { type: 'string' },",
        ),
    ]),

    # ────────────────────────── edit/index.ts ──────────────────────────
    ('src/tools/edit/index.ts', [
        (
"  description: 'Apply a string-replacement edit to a file in the workspace. Tries an exact match first, then progressively more tolerant matching (line-trimmed, block-anchor, whitespace-normalized, indentation-flexible, escape-normalized, trimmed-boundary, context-aware) so stale/whitespace-drifted oldStrings still resolve. Always replaces a real block in the file, preserves the file\\'s line endings and UTF-8 BOM, refuses ambiguous or disproportionate matches, and serializes concurrent edits to the same file. Set replaceAll to true to replace every occurrence.',",
"  description: '对工作区文件做字符串替换编辑（容忍空白/缩进漂移，保留行尾与 BOM，拒绝歧义匹配）。',",
        ),
        (
"      path: { type: 'string', description: 'Path relative to workspace' },",
"      path: { type: 'string' },",
        ),
        (
"      oldString: { type: 'string', description: 'The text to search for (copy it exactly from the file — indentation and line endings are normalized for matching, so drift is tolerated). Provide enough surrounding context for a unique match.' },",
"      oldString: { type: 'string', description: '要查找的文本，尽量带足够上下文保证唯一匹配' },",
        ),
        (
"      newString: { type: 'string', description: 'The replacement text (must be different from oldString)' },",
"      newString: { type: 'string' },",
        ),
        (
"      replaceAll: { type: 'boolean', description: 'Replace all occurrences instead of just the first (optional)' },",
"      replaceAll: { type: 'boolean' },",
        ),
    ]),

    # ────────────────────────── skill_manager/index.ts ──────────────────────────
    ('src/tools/skill_manager/index.ts', [
        (
"  description: 'Discover skill packages and lazily activate child skills.',",
"  description: '发现技能包并懒加载激活子技能（写操作已下沉到 REST 技能工作台）。',",
        ),
        (
"        description: 'Use list_packages/describe_package first, then activate for a package child. (create_package/update/delete 已下沉到 REST 技能工作台，不再由模型直接调用。)',",
"        description: '先用 list_packages/describe_package 查看，再 activate 激活',",
        ),
        (
"""      package_id: { type: 'string', description: 'Skill package id.' },
      package_name: { type: 'string', description: 'Display name for a new skill package.' },
      description: { type: 'string', description: 'Description for a new skill package.' },
      version: { type: 'string', description: 'Optional semantic version for a new skill package.' },
      skill_id: { type: 'string', description: 'Child skill id for activate/deactivate.' },
      skill_name: { type: 'string', description: 'Canonical package or package/child reference.' },
      category: { type: 'string', description: 'Category for create_package.' },
      content: { type: 'string', description: 'Full SKILL.md content for create_package/update.' },""",
"""      package_id: { type: 'string' },
      skill_id: { type: 'string' },
      skill_name: { type: 'string' },""",
        ),
    ]),

    # ────────────────────────── webfetch/index.ts ──────────────────────────
    ('src/tools/webfetch/index.ts', [
        (
"""  description: `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.
Use this when you need to retrieve content from a specific URL.`,""",
"  description: '抓取 HTTP(S) URL 内容，默认返回 markdown。',",
        ),
        (
"      url: { type: 'string', description: 'The HTTP or HTTPS URL to fetch content from' },",
"      url: { type: 'string' },",
        ),
        (
"""      format: {
        type: 'string',
        enum: ['text', 'markdown', 'html'],
        description: 'The format to return the content in (text, markdown, or html). Defaults to markdown.',
      },""",
"""      format: {
        type: 'string',
        enum: ['text', 'markdown', 'html'],
      },""",
        ),
        (
"""      readable: {
        type: 'boolean',
        description: 'When true, extract the main article content (Reader Mode) before converting. Only applies to HTML pages. Defaults to false.',
      },""",
"""      readable: {
        type: 'boolean',
        description: '为 true 时抽取正文（Reader Mode，仅 HTML）',
      },""",
        ),
        (
"""      timeout: {
        type: 'number',
        description: `Optional timeout in seconds (maximum: ${MAX_TIMEOUT_SECONDS})`,
      },""",
"""      timeout: {
        type: 'number',
      },""",
        ),
    ]),
]

failures = 0
for rel, pairs in EDITS:
    p = ROOT / rel
    s = p.read_text(encoding='utf-8').replace('\r\n', '\n')
    for old, new in pairs:
        n = s.count(old)
        if n == 0:
            print(f'MISS  {rel}: {old[:70]!r}')
            failures += 1
            continue
        s = s.replace(old, new, 1)
    p.write_text(s.replace('\n', '\r\n'), encoding='utf-8')
    print(f'OK    {rel}')

sys.exit(1 if failures else 0)