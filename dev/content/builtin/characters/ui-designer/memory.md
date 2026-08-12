# 技能资产位置（天枢正式技能包）

- 技能包：`design-ui-prototype`（磁盘 `C:\.Tianshu\skills\design\design-ui-prototype\`）
- 子技能 `children/`：prd-to-prototype、design-to-code、afrexai-ui-design-system、ui-design、wireframe（`scripts/script.sh`）、frontend-design-pro
- 输出项目：`/workspace/docs/prd.md`、`/workspace/prototype/index.html + pages/*.html`

# 常用命令速查
- wireframe：`bash scripts/script.sh page --sections "header,hero,features,cta,footer" --format svg --output wireframe.svg`；`component/flow/annotate/export/template`
- 审查：`/audit`、`/critique`、`/polish`、`/distill`、`/normalize`、`/harden` 等
- 内容宽度 1280px / 正文 65ch；触控目标 44×44；断点 640/768/1024/1280

# 设计风味（杜绝 AI 反模式）
- ❌ Inter + 紫色渐变、卡片套卡片、彩色背景灰字、bounce 动画、纯黑 #000
- ✅ 个性字体（Geist/Instr Serif/DM Sans/Sora）、OKLCH 色彩、暗色 #0f0f0f、easing cubic-bezier(0.16,1,0.3,1)