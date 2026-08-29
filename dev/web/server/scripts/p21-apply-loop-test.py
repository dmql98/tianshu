# P2-1: loop.test.ts 补 snipRatio 走 policy 的断言（CRLF 安全）
import sys
from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'src/agent/loop/loop.test.ts'
s = p.read_text(encoding='utf-8', newline='').replace('\r\n', '\n')

pairs = [
    # import 补 DEFAULT_COMPACT_POLICY / shouldSnipTokens
    (
"""import { estimateTokens, shouldCompact, shouldSnip, trimToolResults, systemMessageEnd, resolveKeepTokens, resolveCompactPolicy, manualCompactThreshold } from './loop-policy.js'""",
"""import { estimateTokens, shouldCompact, shouldSnip, shouldSnipTokens, trimToolResults, systemMessageEnd, resolveKeepTokens, resolveCompactPolicy, manualCompactThreshold, DEFAULT_COMPACT_POLICY } from './loop-policy.js'""",
    ),
    # P1-1 boundary 断言后补 P2-1 断言块
    (
"""  assert(!shouldCompact(boundary), '160054 tok not compacted at 0.85 (was at 0.75)')
  console.log('  OK token estimation and thresholds')""",
"""  assert(!shouldCompact(boundary), '160054 tok not compacted at 0.85 (was at 0.75)')

  // P2-1: snipRatio 来自 policy（默认回退 SNIP_RATIO=0.6），可被模型级 compact_snip_ratio 覆盖。
  assert(!shouldSnipTokens(100000, 200000), 'default snipRatio 0.6 not triggered at 100k/200k')
  assert(shouldSnipTokens(100000, 200000, { ...DEFAULT_COMPACT_POLICY, snipRatio: 0.4 }), 'policy snipRatio 0.4 triggers at 100k/200k')
  assert(!shouldSnipTokens(70000, 200000, { ...DEFAULT_COMPACT_POLICY, snipRatio: 0.4 }), 'policy snipRatio 0.4 not triggered at 70k/200k')
  console.log('  OK token estimation and thresholds')""",
    ),
]

for old, new in pairs:
    n = s.count(old)
    if n != 1:
        print(f'MISS({n}): {old[:70]!r}')
        sys.exit(1)
    s = s.replace(old, new, 1)

p.write_text(s.replace('\n', '\r\n'), encoding='utf-8', newline='')
print('OK loop.test.ts')