---
name: graphify
description: "Use for any question about a codebase, its architecture, file relationships, or project content — especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools."
triggers:
  - graph: /graphify/代码图谱/知识图谱/knowledge graph/graph
  - codebase: 代码库/项目分析/架构/architecture/代码关系
  - query: 查询/explain/path/路径/解释
---

# /graphify

Turn any folder of files into a navigable knowledge graph with community detection, an honest audit trail, and three outputs: interactive HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

## Quick Commands

```
/graphify .                                  # build graph for current folder
/graphify <path>                             # build graph for specific path
/graphify <path> --update                    # incremental update
/graphify <path> --cluster-only              # rerun clustering
/graphify <path> --mode deep                 # thorough extraction
/graphify query "<question>"                 # query the graph
/graphify path "A" "B"                       # shortest path between two concepts
/graphify explain "Symbol"                   # explain a node
```

## Outputs

```
graphify-out/
├── graph.html       interactive graph, open in browser
├── GRAPH_REPORT.md  audit report
└── graph.json       raw graph data
```

## Usage

1. Check if `graphify-out/graph.json` exists → if so, use `graphify query` directly
2. Otherwise run `/graphify .` to build the graph
3. Query with `graphify query/path/explain`
