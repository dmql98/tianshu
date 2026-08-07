# UI 原型设计（design-ui-prototype）

覆盖从产品需求零提问直出 PRD → 设计方向 → 像素级还原 → 设计令牌/组件规范 → UI 质量审查 → 低保真线框 → 高保真 HTML/Tailwind 原型的完整 UI 原型设计工作流。支持 Figma/Sketch 设计稿解析、响应式布局、移动优先、设计系统构建与交互原型生成。

根据用户目标选择并激活对应子技能（按需加载，勿全部预加载）：

| 用户目标 | 激活子技能 |
|----------|-----------|
| 产品想法 → 零提问直出 PRD + 高保真交互原型 | `design-ui-prototype/prd-to-prototype` |
| 设计稿（Figma/Sketch/图片）→ 像素级还原前端代码 | `design-ui-prototype/design-to-code` |
| 完整设计系统/组件/令牌规范（方法论引擎） | `design-ui-prototype/afrexai-ui-design-system` |
| UI 设计基础与质量审查（布局/排版/色彩/无障碍，反模式） | `design-ui-prototype/ui-design` |
| 低保真线框 / 用户流程（ASCII/SVG/HTML） | `design-ui-prototype/wireframe` |
| 前端设计质量打磨（/audit /polish /critique 等） | `design-ui-prototype/frontend-design-pro` |

## 完整工作流（串联）
1. 需求分析与 PRD 输出 → 2.（如有）设计稿解析与像素还原 → 3. 设计系统与令牌制定 → 4. UI 质量审查 → 5. 低保真线框 → 6. 高保真 HTML/Tailwind 原型输出

## 规范基线
- 视觉品质对标 Awwwards / Apple / Dribbble 现代产品；拒绝默认系统蓝、粗糙阴影、模板感
- 响应式/移动优先；WCAG AA 对比度与无障碍；语义化 HTML + ARIA
- 纯 HTML + Tailwind CDN + Vanilla JS（禁编译框架）；界面默认简体中文
- 详情见各子技能 SKILL.md