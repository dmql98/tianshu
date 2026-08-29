# P2-1 前端类型 + 绿点判断（CRLF 安全）
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent.parent / 'client'  # web/client

def load(p: Path) -> str:
    return p.read_text(encoding='utf-8', newline='').replace('\r\n', '\n')

def save(p: Path, s: str) -> None:
    p.write_text(s.replace('\n', '\r\n'), encoding='utf-8', newline='')

def apply(p: Path, pairs: list[tuple[str, str]]) -> None:
    s = load(p)
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            print(f'MISS({n}) in {p.name}: {old[:70]!r}')
            sys.exit(1)
        s = s.replace(old, new, 1)
    save(p, s)
    print(f'OK {p.name}')

# 1. types/index.ts（ProviderModel/models 类型）
apply(BASE / 'src/types/index.ts', [
    (
"""  /** 该模型单独指定的压缩保留比例（0~1），覆盖全局默认 0.16。 */
  compact_retain_ratio?: number""",
"""  /** 该模型单独指定的压缩保留比例（0~1），覆盖全局默认 0.16。 */
  compact_retain_ratio?: number
  /** 该模型单独指定的剪枝触发阈值（0~1），覆盖全局默认 0.6。 */
  compact_snip_ratio?: number""",
    ),
])

# 2. api/providers.ts
apply(BASE / 'src/api/providers.ts', [
    (
"""  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_provider?: string""",
"""  compact_threshold_ratio?: number
  compact_retain_ratio?: number
  compact_snip_ratio?: number
  compact_provider?: string""",
    ),
])

# 3. SettingsPage.tsx（绿点判断）
apply(BASE / 'src/pages/SettingsPage.tsx', [
    (
"""                          {(model as any).compact_threshold_ratio != null || (model as any).compact_retain_ratio != null || (model as any).compact_provider != null || (model as any).compact_model != null ? (""",
"""                          {(model as any).compact_threshold_ratio != null || (model as any).compact_retain_ratio != null || (model as any).compact_snip_ratio != null || (model as any).compact_provider != null || (model as any).compact_model != null ? (""",
    ),
])

print('ALL OK')