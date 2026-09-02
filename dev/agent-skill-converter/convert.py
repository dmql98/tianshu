#!/usr/bin/env python3
"""
Agent Skill Converter
=====================
在 Agent Skills 开放标准 (Codex/Claude Code/OpenClaw/Hermes) 与天枢技能包格式之间转换。

Agent Skills 标准:
  - SKILL.md (YAML frontmatter: name, description)
  - 可选 references/, scripts/, assets/
  - 无 skill-package.json

天枢技能包格式:
  - skill-package.json (元数据清单)
  - SKILL.md (YAML frontmatter)
  - 可选 children/<child>/SKILL.md (子技能)
  - 可选 references/, scripts/, assets/

用法:
  python convert.py agent-to-tianshu <skill-dir> <output-dir>  [--category web]
  python convert.py tianshu-to-agent <skill-dir> <output-dir>
  python convert.py batch-agent-to-tianshu <source-dir> <output-dir> [--category web]
  python convert.py analyze <skill-dir>  # 分析并输出格式信息
"""

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from pathlib import Path
from typing import Any, Optional


# ── YAML frontmatter 解析（不引入 pyyaml 依赖）───────────────────────

def parse_frontmatter(content: str) -> tuple[dict, str]:
    """
    解析 YAML frontmatter，返回 (metadata_dict, body)。
    支持 --- 包围的标准 frontmatter。
    """
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n', content, re.DOTALL)
    if not match:
        return {}, content

    raw_yaml = match.group(1)
    body = content[match.end():]
    metadata = _parse_simple_yaml(raw_yaml)
    return metadata, body


def _parse_simple_yaml(raw: str) -> dict:
    """简易 YAML 解析器，覆盖 frontmatter 常见场景。"""
    result = {}
    current_key = None
    current_value_lines = []
    in_list = False
    list_items = []

    for line in raw.split('\n'):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue

        # 顶层键值对
        top_match = re.match(r'^(\w[\w-]*)\s*:\s*(.*)', line)
        if top_match and not line.startswith(' ') and not line.startswith('-'):
            # 保存上一个键
            if current_key:
                _flush_value(result, current_key, current_value_lines, in_list, list_items)
                current_value_lines = []
                in_list = False
                list_items = []

            current_key = top_match.group(1)
            rest = top_match.group(2).strip()

            if rest == '':
                # 可能是列表或多行值
                pass
            elif rest.startswith('[') and rest.endswith(']'):
                # 内联列表 [a, b, c]
                items = [x.strip().strip('"').strip("'") for x in rest[1:-1].split(',') if x.strip()]
                result[current_key] = items
                current_key = None
            else:
                result[current_key] = _coerce_value(rest)
                current_key = None
        elif stripped.startswith('- ') and current_key:
            # 列表项
            in_list = True
            item_content = stripped[2:].strip()

            if item_content.startswith('{'):
                # 内联对象
                list_items.append(_parse_inline_object(item_content))
            else:
                list_items.append(_coerce_value(item_content))
        elif in_list and line.startswith('  ') and list_items:
            # 列表项的子属性（缩进）
            prop_match = re.match(r'^\s+(\w[\w-]*)\s*:\s*(.*)', line)
            if prop_match and list_items:
                key = prop_match.group(1)
                val = _coerce_value(prop_match.group(2).strip())
                if isinstance(list_items[-1], dict):
                    list_items[-1][key] = val
        else:
            current_value_lines.append(stripped)

    # 保存最后一个键
    if current_key:
        _flush_value(result, current_key, current_value_lines, in_list, list_items)

    return result


def _flush_value(result: dict, key: str, lines: list, in_list: bool, list_items: list):
    if in_list and list_items:
        result[key] = list_items
    elif lines:
        val = '\n'.join(lines)
        result[key] = _coerce_value(val)


def _parse_inline_object(s: str) -> dict:
    """解析 {id: x, name: y, ...} 格式的内联对象。"""
    s = s.strip()
    if s.startswith('{'):
        s = s[1:]
    if s.endswith('}'):
        s = s[:-1]

    obj = {}
    for part in s.split(','):
        part = part.strip()
        kv = part.split(':', 1)
        if len(kv) == 2:
            obj[kv[0].strip()] = _coerce_value(kv[1].strip())
    return obj


def _coerce_value(s: str):
    """将字符串值转换为适当的 Python 类型。"""
    if not s:
        return ''
    # 去掉引号
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    if s.lower() in ('true', 'yes'):
        return True
    if s.lower() in ('false', 'no'):
        return False
    if s.isdigit():
        return int(s)
    return s


def dump_frontmatter(metadata: dict, body: str) -> str:
    """将 metadata dict 和 body 重新组装为带 frontmatter 的 markdown。"""
    lines = ['---']
    for key, value in metadata.items():
        if isinstance(value, list):
            lines.append(f'{key}:')
            for item in value:
                if isinstance(item, dict):
                    lines.append(f'  - id: {item.get("id", "")}')
                    for k, v in item.items():
                        if k != 'id':
                            lines.append(f'    {k}: {v}')
                else:
                    lines.append(f'  - {item}')
        elif isinstance(value, bool):
            lines.append(f'{key}: {"true" if value else "false"}')
        elif isinstance(value, int):
            lines.append(f'{key}: {value}')
        else:
            lines.append(f'{key}: "{value}"')
    lines.append('---')
    lines.append('')
    lines.append(body.rstrip())
    return '\n'.join(lines) + '\n'


# ── 格式检测 ─────────────────────────────────────────────────────────

def detect_format(skill_dir: Path) -> str:
    """
    检测技能目录的格式。
    返回: 'tianshu' | 'agent-skills' | 'unknown'
    """
    has_skill_package = (skill_dir / 'skill-package.json').exists()
    has_skill_md = (skill_dir / 'SKILL.md').exists()

    if has_skill_package and has_skill_md:
        return 'tianshu'
    elif has_skill_md and not has_skill_package:
        return 'agent-skills'
    else:
        return 'unknown'


def analyze_skill(skill_dir: Path) -> dict:
    """分析技能目录，返回格式信息。"""
    fmt = detect_format(skill_dir)
    result = {
        'path': str(skill_dir),
        'format': fmt,
        'has_skill_md': (skill_dir / 'SKILL.md').exists(),
        'has_skill_package': (skill_dir / 'skill-package.json').exists(),
        'has_children': (skill_dir / 'children').is_dir(),
        'has_references': (skill_dir / 'references').is_dir(),
        'has_scripts': (skill_dir / 'scripts').is_dir(),
        'has_assets': (skill_dir / 'assets').is_dir(),
    }

    if result['has_skill_md']:
        content = (skill_dir / 'SKILL.md').read_text(encoding='utf-8')
        metadata, body = parse_frontmatter(content)
        result['frontmatter'] = metadata
        result['body_preview'] = body[:200].strip()

    if result['has_skill_package']:
        with open(skill_dir / 'skill-package.json', 'r', encoding='utf-8') as f:
            result['skill_package'] = json.load(f)

    if result['has_children']:
        children_dir = skill_dir / 'children'
        result['children'] = [
            d.name for d in children_dir.iterdir()
            if d.is_dir() and (d / 'SKILL.md').exists()
        ]

    return result


# ── Agent Skills → 天枢 转换 ────────────────────────────────────────

def agent_to_tianshu(skill_dir: Path, output_dir: Path, category: str = 'community') -> Path:
    """
    将 Agent Skills 标准格式转换为天枢技能包格式。

    步骤:
    1. 解析 SKILL.md frontmatter
    2. 生成 skill-package.json
    3. 保留原 SKILL.md 和子目录
    """
    if not (skill_dir / 'SKILL.md').exists():
        raise FileNotFoundError(f'{skill_dir} 中没有 SKILL.md')

    content = (skill_dir / 'SKILL.md').read_text(encoding='utf-8')
    metadata, body = parse_frontmatter(content)

    # 生成包 ID
    skill_name = metadata.get('name', skill_dir.name)
    skill_id = _slugify(skill_name)

    # 构建 skill-package.json
    skill_package = {
        'source': 'agent-skills',
        'schemaVersion': 1,
        'id': skill_id,
        'name': metadata.get('name', skill_id),
        'version': metadata.get('version', '1.0.0'),
        'category': metadata.get('category', category),
        'description': metadata.get('description', ''),
        'tags': metadata.get('tags', []),
        'root': 'SKILL.md',
        'children': [],
    }

    # 检查 frontmatter 中是否有 children 定义
    if 'children' in metadata and isinstance(metadata['children'], list):
        for child in metadata['children']:
            if isinstance(child, dict):
                skill_package['children'].append({
                    'id': child.get('id', ''),
                    'name': child.get('name', ''),
                    'path': f"children/{child.get('id', '')}",
                    'description': child.get('description', ''),
                    'preload': child.get('preload', False),
                })

    # 创建输出目录
    dest = output_dir / skill_id
    dest.mkdir(parents=True, exist_ok=True)

    # 写入 skill-package.json
    with open(dest / 'skill-package.json', 'w', encoding='utf-8') as f:
        json.dump(skill_package, f, ensure_ascii=False, indent=2)

    # 写入 SKILL.md（保留原始 frontmatter）
    shutil.copy2(skill_dir / 'SKILL.md', dest / 'SKILL.md')

    # 复制子目录
    for dirname in ['references', 'scripts', 'assets', 'children']:
        src_subdir = skill_dir / dirname
        if src_subdir.is_dir():
            shutil.copytree(src_subdir, dest / dirname, dirs_exist_ok=True)

    # 复制其他文件（如 .env、config 等）
    for item in skill_dir.iterdir():
        if item.is_file() and item.name not in ('SKILL.md',):
            if not item.name.startswith('.'):
                shutil.copy2(item, dest / item.name)

    return dest


# ── 天枢 → Agent Skills 转换 ────────────────────────────────────────

def tianshu_to_agent(skill_dir: Path, output_dir: Path) -> Path:
    """
    将天枢技能包格式转换为 Agent Skills 标准格式。

    步骤:
    1. 读取 skill-package.json
    2. 从 SKILL.md frontmatter 中去除天枢扩展字段
    3. 去除 children/ 中的子技能（Agent Skills 不支持嵌套）
    """
    skill_package_path = skill_dir / 'skill-package.json'
    if not skill_package_path.exists():
        raise FileNotFoundError(f'{skill_dir} 中没有 skill-package.json')

    with open(skill_package_path, 'r', encoding='utf-8') as f:
        skill_package = json.load(f)

    skill_id = skill_package.get('id', skill_dir.name)

    # 创建输出目录
    dest = output_dir / skill_id
    dest.mkdir(parents=True, exist_ok=True)

    # 处理 SKILL.md：去除天枢扩展字段
    if (skill_dir / 'SKILL.md').exists():
        content = (skill_dir / 'SKILL.md').read_text(encoding='utf-8')
        metadata, body = parse_frontmatter(content)

        # 移除天枢扩展字段
        tianshu_fields = {'category', 'version', 'children', 'source', 'tags'}
        cleaned_metadata = {k: v for k, v in metadata.items() if k not in tianshu_fields}

        # 写入清理后的 SKILL.md
        new_content = dump_frontmatter(cleaned_metadata, body)
        with open(dest / 'SKILL.md', 'w', encoding='utf-8') as f:
            f.write(new_content)

    # 复制子目录（references, scripts, assets）
    for dirname in ['references', 'scripts', 'assets']:
        src_subdir = skill_dir / dirname
        if src_subdir.is_dir():
            shutil.copytree(src_subdir, dest / dirname, dirs_exist_ok=True)

    # Agent Skills 不支持嵌套子技能，将 children 展平
    children_dir = skill_dir / 'children'
    if children_dir.is_dir():
        # 在 body 中追加子技能信息
        if (dest / 'SKILL.md').exists():
            existing = (dest / 'SKILL.md').read_text(encoding='utf-8')
            section = '\n\n## 子技能\n\n'
            for child_dir in sorted(children_dir.iterdir()):
                if child_dir.is_dir() and (child_dir / 'SKILL.md').exists():
                    child_content = (child_dir / 'SKILL.md').read_text(encoding='utf-8')
                    child_meta, _ = parse_frontmatter(child_content)
                    child_name = child_meta.get('name', child_dir.name)
                    child_desc = child_meta.get('description', '')
                    section += f'### {child_name}\n\n{child_desc}\n\n'
                    section += f'> 详见 `{child_dir.name}/SKILL.md`\n\n'
            with open(dest / 'SKILL.md', 'w', encoding='utf-8') as f:
                f.write(existing + section)

    return dest


# ── 批量转换 ─────────────────────────────────────────────────────────

def batch_agent_to_tianshu(source_dir: Path, output_dir: Path, category: str = 'community') -> list[dict]:
    """
    批量将 Agent Skills 标准格式转换为天枢技能包格式。
    扫描 source_dir 下所有含 SKILL.md 的目录。
    """
    results = []

    for item in sorted(source_dir.iterdir()):
        if item.is_dir() and (item / 'SKILL.md').exists():
            fmt = detect_format(item)
            if fmt == 'agent-skills':
                try:
                    dest = agent_to_tianshu(item, output_dir, category)
                    results.append({
                        'source': str(item),
                        'dest': str(dest),
                        'status': 'success',
                    })
                    print(f'  ✓ {item.name} → {dest.name}')
                except Exception as e:
                    results.append({
                        'source': str(item),
                        'dest': None,
                        'status': 'error',
                        'error': str(e),
                    })
                    print(f'  ✗ {item.name}: {e}')
            elif fmt == 'tianshu':
                results.append({
                    'source': str(item),
                    'dest': None,
                    'status': 'skipped',
                    'reason': 'already tianshu format',
                })
                print(f'  - {item.name}: 已是天枢格式，跳过')

    return results


# ── 辅助函数 ─────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    """将名称转换为 URL/文件名安全的 slug。"""
    s = name.lower().strip()
    s = re.sub(r'[^\w\s-]', '', s)
    s = re.sub(r'[\s_]+', '-', s)
    s = re.sub(r'-+', '-', s)
    return s.strip('-')


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Agent Skill Converter: Agent Skills ↔ 天枢技能包格式转换',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
        示例:
          python convert.py agent-to-tianshu ./my-skill ./output --category web
          python convert.py tianshu-to-agent ./skills/my-skill ./output
          python convert.py batch-agent-to-tianshu ./skills-source ./output --category community
          python convert.py analyze ./my-skill
        """)
    )
    parser.add_argument('command', choices=['agent-to-tianshu', 'tianshu-to-agent', 'batch-agent-to-tianshu', 'analyze'],
                        help='转换命令')
    parser.add_argument('source', type=Path, help='源目录')
    parser.add_argument('output', nargs='?', type=Path, help='输出目录')
    parser.add_argument('--category', default='community', help='分类（默认 community）')

    args = parser.parse_args()

    if args.command == 'analyze':
        info = analyze_skill(args.source)
        print(json.dumps(info, ensure_ascii=False, indent=2, default=str))

    elif args.command == 'agent-to-tianshu':
        if not args.output:
            parser.error('agent-to-tianshu 需要 output 参数')
        dest = agent_to_tianshu(args.source, args.output, args.category)
        print(f'转换完成: {dest}')

    elif args.command == 'tianshu-to-agent':
        if not args.output:
            parser.error('tianshu-to-agent 需要 output 参数')
        dest = tianshu_to_agent(args.source, args.output)
        print(f'转换完成: {dest}')

    elif args.command == 'batch-agent-to-tianshu':
        if not args.output:
            parser.error('batch-agent-to-tianshu 需要 output 参数')
        results = batch_agent_to_tianshu(args.source, args.output, args.category)
        success = sum(1 for r in results if r['status'] == 'success')
        print(f'\n共 {len(results)} 个技能，成功 {success} 个')


if __name__ == '__main__':
    main()
