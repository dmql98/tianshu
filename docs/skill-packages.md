# Skill packages

TianShu uses hierarchical skill packages as its only supported skill format.

## Directory layout

```text
skills/<category>/<package-id>/
├── skill-package.json
├── SKILL.md
├── children/
│   └── <child-id>/SKILL.md
├── scripts/
├── references/
└── assets/
```

`skill-package.json` is mandatory. Directories without a manifest are ignored by discovery and cannot be bound or activated. A package may contain only its root skill (`children: []`) or any number of declared child skills.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "uzi",
  "name": "UZI 股票分析",
  "version": "3.9.2",
  "category": "finance",
  "description": "股票研究与风险分析技能包",
  "root": "SKILL.md",
  "children": [
    {
      "id": "deep-analysis",
      "name": "深度分析",
      "path": "children/deep-analysis",
      "description": "公司与行业深度研究",
      "preload": false
    }
  ]
}
```

Package and child IDs may contain letters, numbers, dots, underscores and hyphens. Root and child paths must stay inside the package directory.

## Runtime

Characters bind package IDs. The initial system prompt contains only package and child summaries. A child is loaded with `skill_manager.activate`, is limited to an authorized package, and remains active for that session. Up to three child skills may be active at once.

Character bindings use the following shape:

```json
{
  "skillBindings": [
    {
      "packageId": "uzi",
      "enabled": true,
      "preloadSkills": []
    }
  ]
}
```

`skillBindings` is the authoritative binding source. The serialized `skills` array is only a derived summary for existing character views and is never used to discover or authorize a skill.

## Creating packages

All supported creation paths now produce the standard format, including packages with no children:

- The UI route `/skills/new`.
- `POST /api/skills/packages`.
- `skill_manager` with `action="create_package"`.

Creation writes `SKILL.md` and `skill-package.json` into a sibling staging directory and atomically renames it into place.

## Migrated built-in series

The current data set uses standard physical packages for the main skill series:

- `lowcode`: 7 children for overview, analysis, design, devices, variables, flows and frontend pages.
- `xhs`: 5 children for authentication, exploration, content operations, interaction and publishing.
- `tianshu-system`: 7 children for characters, sessions, providers, MCP, skill authoring, constraints and failure recovery.
- `uzi`: 4 children for deep analysis, investor panel, LHB analysis and trap detection.
- `patent-disclosure-skill`: one root patent-disclosure skill.
- `agent-reach`: one root web-reach skill.
- `graphify`: one root visualization skill.

Flat names and the deleted `skills/skill-packages.json` alias registry are not resolved. References must use a package ID or the canonical `<package-id>/<child-id>` form.
